<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Staging Workflow
**IMPORTANT:** Schema or DB-breaking changes must be tested on a Supabase branch before being applied to production. Past incidents involving RPC breakage and cross-tenant data issues were caused by direct-to-production changes. Always verify migrations and server functions in a staging environment first.
