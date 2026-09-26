# AI Programme Consultant — No API Key Build

> **Update:** This document describes an earlier backend-driven design
> (`database/programme_consultant.py`, `/api/consultant/chat`) that was never actually built - the
> real implementation is the client-side matching engine in `ProgrammeConsultantPage.tsx` described
> in `FRONTEND-PROGRAMME-CONSULTANT.md`. DeepSeek has since been added on top of that real
> implementation (`POST /api/consultant/recommend`, see `database/README.md`), so the "no API key,
> no LLM" positioning below no longer applies - DeepSeek is optional (the app degrades gracefully
> without it) but is real when configured.

This build adds the Petrosains Programme Consultant directly to the existing CORE INVENTORY application while preserving YOLO, Inventory, Stock Check, authentication, history, settings, shared inventory, and offline mutation behaviour.

## Important: no Gemini/API key is required

This version does **not** call Gemini, OpenAI, or any other external LLM service. The consultant runs locally inside the Flask backend using the supplied structured Programme Catalogue plus deterministic natural-language extraction, constraint filtering, verified catalogue ranking, programme assembly, and live inventory cross-reference.

That means:

- no `GEMINI_API_KEY`
- no `python-dotenv`
- no `google-genai` Python package
- no paid external AI call
- no network dependency for the consultant itself

The trade-off is that this is a local catalogue-guided recommendation engine rather than a generative LLM. It still behaves conversationally, supports follow-up changes such as “actually we only have 2 hours” or “we won’t have internet”, and follows the anti-hallucination rules from the supplied prompt.

## What was added

### Frontend
- `src/pages/ProgrammeConsultantPage.tsx` — conversational Programme Consultant UI.
- `src/services/programmeConsultantService.ts` — authenticated API client.
- `src/types/programmeConsultant.ts` — structured response types.
- Sidebar / header / `App.tsx` integration through a new `consultant` page ID.

### Backend
- `database/programme_consultant.py` — local stakeholder requirement extraction, catalogue filtering/ranking, constraint checks, programme storyline/journey generation, proposed enhancements, and read-only live inventory matching.
- `database/data/programme_catalogue.json` — 21 verified programme offerings plus theme mappings, objective mappings, and 12 constraint rules from the supplied Programme Catalogue.
- `POST /api/consultant/chat` — authenticated consultant endpoint.
- `GET /api/consultant/status` — confirms the local consultant is ready and reports catalogue size.

## Anti-hallucination design

The application never creates an official Petrosains offering from free text. Every verified recommendation is selected from `database/data/programme_catalogue.json`, and the UI renders the exact verified Offering_ID and catalogue fields.

New ideas appear separately as **PROPOSED ENHANCEMENT**. Live inventory matches are labelled supporting context and are never treated as proof that an activity exists or as a verified activity requirement.

## Local development

Use two terminals.

**Terminal 1 — Flask**

```powershell
python -m pip install -r database/requirements.txt
python database/app.py
```

**Terminal 2 — React/Vite**

```powershell
npm install
npm run dev
```

No `.env` file is required for the Programme Consultant. `.env.example` contains only optional deployment/session settings.

## Conversation behaviour

The page keeps the current chat in `sessionStorage`. Recent user messages are sent with each request so newer constraints can replace earlier ones. Examples:

- “Actually we only have 2 hours.” → duration is recalculated.
- “We won’t have internet.” → offerings requiring internet are excluded.
- “Make it more inclusive.” → verified accessibility notes are prioritised and proposed inclusive enhancements are shown.

## Data hierarchy

1. **Programme Catalogue** = authority for verified Petrosains offerings.
2. **Current CORE INVENTORY server state** = read-only operational context.
3. **Proposed enhancements** = clearly labelled ideas, never passed off as existing catalogue offerings.

The consultant never checks items in/out, changes quantities, approves stock checks, or mutates inventory.
