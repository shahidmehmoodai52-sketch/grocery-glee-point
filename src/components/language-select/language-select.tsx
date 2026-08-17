import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const languages = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ur', name: 'اردو (Urdu)', dir: 'rtl' },
  { code: 'ar', name: 'العربية (Arabic)', dir: 'rtl' },
  { code: 'es', name: 'Español (Spanish)', dir: 'ltr' },
  { code: 'de', name: 'Deutsch (German)', dir: 'ltr' },
  { code: 'no', name: 'Norsk (Norwegian)', dir: 'ltr' },
];

export function LanguageSelect({ className }: { className?: string }) {
  const { i18n } = useTranslation();

  const changeLanguage = async (code: string) => {
    try {
      console.log('Changing language to:', code);
      await i18n.changeLanguage(code);
      const lang = languages.find((l) => l.code === code);
      if (lang && typeof document !== 'undefined') {
        document.documentElement.dir = lang.dir;
        document.documentElement.lang = lang.code;
        // Persistence
        localStorage.setItem('i18nextLng', code);
      }
    } catch (err) {
      console.error('Failed to change language:', err);
    }
  };

  const currentLang = languages.find((l) => l.code === i18n.language) || languages[0];

  React.useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = currentLang.dir;
      document.documentElement.lang = currentLang.code;
    }
  }, [currentLang]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-2 px-2", className)}>
          <Globe className="h-4 w-4" />
          <span className="hidden sm:inline text-xs font-medium">{currentLang.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              changeLanguage(lang.code);
            }}
            className={cn(
              "cursor-pointer",
              i18n.language === lang.code && "bg-accent font-semibold"
            )}
          >
            {lang.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
