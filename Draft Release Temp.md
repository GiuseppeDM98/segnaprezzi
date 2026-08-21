## ✨ New Features

- Added the first working shell of the app: an Italian dashboard at `/` and an English dashboard at `/en`, with full Italian/English language support end to end
- Added automatic dark mode that follows your device's theme, with no flash of the wrong color on load
- Added user accounts — sign up with email and password, and stay signed in for up to 30 days
- Added a way to export your complete price history and account data as a JSON file
- Self-hosters can now close new signups on their own instance while keeping it usable for existing users
- Added price tag scanning — photograph a shelf tag and Claude Haiku 4.5 reads the product, brand, category, price and price per kg/L for you
- Added a review step before anything is saved: every extracted field is editable, and prices that don't add up or that the AI wasn't sure about are flagged for you to check
- Added offline capture — photos are compressed and queued on your phone straight away, so a supermarket with no signal never costs you a price tag
- Added a manual entry form for items without a tag, with the price per kg/L worked out as you type and grams or millilitres accepted directly
- Added a fuel quick entry form: pick benzina, diesel, GPL or metano, type any two of price per unit, quantity and total, and the third fills itself in
- Added promotion tracking — mark a price as a discount, loyalty-card price, coupon or multi-buy, so you can later decide whether promos count toward your index

## 🔧 Improvements

- Fuel entries now keep the three decimals petrol pumps actually display (€1.799/L), instead of rounding them away
- Methane is measured in kilograms, the way Italian pumps sell it, rather than being forced into litres

## 🔒 Security

- Your data is now private to your account — every store, product, and price you add is visible only to you, never to other users on the same instance
- Pages that show your data now require you to be signed in

## 🏗️ Technical

- Set up the Next.js 16 project foundation (build tooling, linting, type checking, and automated tests) that the rest of the app will be built on
- Retrying a photo upload after a dropped connection now overwrites the same stored photo instead of leaving a duplicate behind, and confirming a shopping trip twice can never create the same entry twice
