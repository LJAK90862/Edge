# edge energy — website

The Edge in Business Energy · edge-energy.uk

## Structure

```
/
├── index.html          — Main website
├── get-started.html    — LOA trigger page (Instantly → DocuSign)
├── quote.html          — Dynamic quote one-pager (client selects supplier)
├── logo-primary-light.svg
├── logo-primary-dark.svg
├── logo-icon.svg
├── netlify.toml        — Netlify deployment config
└── README.md
```

## Deployment

Connected to Netlify via this GitHub repo. Every push to `main` auto-deploys.

## Pages

- `/` — Main marketing site
- `/get-started.html?name=&email=&company=&contact=` — LOA page (linked from Instantly emails)
- `/quote.html?deal=[hubspot-deal-id]` — Quote comparison page (linked from broker email)

## Brand

See `edge_energy_brand_guidelines.html` for full brand guidelines.

Primary green: `#2D6A4F`  
Slate: `#1B2B3A`  
Cream: `#FAFAF8`  
Serif: Playfair Display  
Sans: Inter
