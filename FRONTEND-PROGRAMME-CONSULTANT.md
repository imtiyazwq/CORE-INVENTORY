# Front-end Programme Consultant prototype

> **Update:** Live inventory reservation/checkout at booking confirmation is now implemented
> (`POST /api/programme-catalogue/book`, see `database/README.md`) - the "Not implemented" list
> below is out of date on that one point. A persistent booking record and Activity History entries
> still do not exist.

This build intentionally implements only the front-end side of the requested guest programme-planning workflow.

Implemented in the front end:
- "Plan a Programme" guest quick action on the login page.
- Guest consultant is not present in the staff sidebar.
- Staff login and staff pages remain protected by the existing authentication flow.
- Structured programme requirement form instead of a free-text chat prompt.
- Client-side matching against the bundled verified Programme Catalogue.
- Up to three programme configurations using exact catalogue Offering IDs/titles.
- Programme conduct explanation, participant journey, catalogue constraints and capacity notes.
- Programme selection and review screens.
- Contact details are requested only after a programme has been selected.
- Front-end booking confirmation preview and locally generated reference.

Not implemented by design because this is front-end only:
- Persistent programme booking database record.
- Live inventory re-check at confirmation time.
- Atomic inventory reservation/checkout.
- Staff Inventory "Checked Out" updates from programme bookings.
- Activity History booking transaction entries.
- Multi-user concurrency / double-booking protection.

The UI explicitly labels those backend-dependent areas so the prototype does not falsely claim that stock was reserved.
