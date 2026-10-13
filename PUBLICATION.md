# Publication notes and restrictions

- **Author:** Ayo Ahmed. Independent concept. Not an official Light product, and not affiliated with or endorsed by Light.
- **Light marks:** the logo files in `public/brand/` come unmodified from Light's public brand package. They are used only as context for the role this concept is designed around, smaller than and secondary to the product name and author. Light's brand package states that the name and mark are not licensed to suggest a partnership, endorsement or affiliation. Every screen carries a non-affiliation line. If Light asks, remove `public/brand/` and the single header `<img>`; nothing else depends on them.
- **No copying:** no Light product screens, proprietary fonts, code or customer data are included. Fonts are Rethink Sans and Lora under the SIL Open Font License (`public/fonts/`).
- **No live-site screenshots** are committed. Research screenshots stayed private.
- **Data:** all fixtures are synthetic (see `fixtures/README.md`).
- **Deployment:** configured for Cloudflare Workers Free (`wrangler.jsonc`) and checked with a dry run only. Deploy only to a destination the owner approves, and never over an existing unrelated Worker.
- **Code licence:** MIT (see `LICENSE`). The licence covers this code only, not Light's marks.
