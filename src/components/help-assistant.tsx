import { useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { HelpCircle, Search, ArrowRight, MapPin, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  HELP_TOPICS,
  findTopicByRoute,
  searchTopics,
  type HelpTopic,
} from "@/lib/help/knowledge-base";

const QUICK_QUESTIONS = [
  "purchase kaise banani hai?",
  "customer balance kahan hai?",
  "stock kaise check karun?",
  "sale return kaise karein?",
  "cash flow kya dikhata hai?",
];

/** Score below which we refuse to present a confident answer. */
const CONFIDENT_SCORE = 5;

function TopicCard({
  topic,
  onOpen,
  highlight,
}: {
  topic: HelpTopic;
  onOpen: (topic: HelpTopic) => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (highlight ? "border-primary/40 bg-primary/5" : "bg-card")
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{topic.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{topic.summary}</p>
        </div>
        <Button size="sm" variant="secondary" className="shrink-0 gap-1" onClick={() => onOpen(topic)}>
          Open <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ol className="mt-2 space-y-1.5 text-xs text-foreground/90">
        {topic.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
              {i + 1}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const currentTopic = useMemo(() => findTopicByRoute(pathname), [pathname]);
  const matches = useMemo(() => searchTopics(query), [query]);
  const hasConfidentAnswer = matches.length > 0 && matches[0].score >= CONFIDENT_SCORE;

  const goto = (topic: HelpTopic) => {
    setOpen(false);
    navigate({ to: topic.route as never });
  };

  const relatedToCurrent = useMemo(() => {
    if (!currentTopic) return HELP_TOPICS.slice(0, 4);
    return searchTopics(currentTopic.keywords.slice(0, 6).join(" "), 5)
      .map((m) => m.topic)
      .filter((t) => t.id !== currentTopic.id)
      .slice(0, 3);
  }, [currentTopic]);

  return (
    <>
      {/* no-print keeps this off POS receipts and any printed page. */}
      <div className="no-print fixed bottom-4 right-4 z-[400]">
        <Button
          onClick={() => setOpen(true)}
          className="h-11 gap-2 rounded-full pl-3 pr-4 shadow-lg"
          aria-label="Ask Tillix for help"
        >
          <HelpCircle className="h-5 w-5" />
          <span className="hidden text-sm font-semibold sm:inline">Ask Tillix</span>
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="no-print flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="space-y-1 border-b p-4 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Ask Tillix
            </SheetTitle>
            <SheetDescription className="text-xs">
              English ya Roman Urdu mein sawal likhein — jawab offline bhi kaam karta hai.
            </SheetDescription>
          </SheetHeader>

          <div className="border-b p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                className="pl-9 pr-9"
                placeholder="e.g. purchase kaise banani hai?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {!query && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {QUICK_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuery(q)}
                    className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="space-y-4 p-4">
              {!query && (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        You are here
                      </span>
                      {currentTopic && (
                        <Badge variant="secondary" className="text-[10px]">
                          {currentTopic.title}
                        </Badge>
                      )}
                    </div>
                    {currentTopic ? (
                      <TopicCard topic={currentTopic} onOpen={goto} highlight />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Is screen ke liye alag help topic nahi hai. Neeche se koi section
                        choose karein ya upar sawal likhein.
                      </p>
                    )}
                  </div>

                  {relatedToCurrent.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Related sections
                        </span>
                        {relatedToCurrent.map((t) => (
                          <TopicCard key={t.id} topic={t} onOpen={goto} />
                        ))}
                      </div>
                    </>
                  )}

                  <Separator />
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      All help topics
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {HELP_TOPICS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setQuery(t.title)}
                          className="rounded-md border px-2 py-1 text-[11px] transition-colors hover:bg-accent"
                        >
                          {t.title}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {query && hasConfidentAnswer && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Best answer
                  </span>
                  <TopicCard topic={matches[0].topic} onOpen={goto} highlight />
                  {matches.length > 1 && (
                    <>
                      <Separator />
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Also related
                      </span>
                      {matches.slice(1).map((m) => (
                        <TopicCard key={m.topic.id} topic={m.topic} onOpen={goto} />
                      ))}
                    </>
                  )}
                </div>
              )}

              {query && !hasConfidentAnswer && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-dashed p-3">
                    <p className="text-sm font-medium">Exact match nahi mila</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Is sawal ka pakka jawab help guide mein mojood nahi hai. Neeche
                      diye gaye related sections check karein — jo feature guide mein
                      nahi, uska andaza nahi lagaya jata.
                    </p>
                  </div>
                  {(matches.length > 0
                    ? matches.map((m) => m.topic)
                    : currentTopic
                      ? [currentTopic, ...relatedToCurrent]
                      : HELP_TOPICS.slice(0, 4)
                  ).map((t) => (
                    <TopicCard key={t.id} topic={t} onOpen={goto} />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
