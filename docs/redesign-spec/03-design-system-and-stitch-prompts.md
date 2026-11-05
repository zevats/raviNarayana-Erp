# Ravinarayan ERP — Design System and Google Stitch Prompt Collection

Deliverables 8 and 9. How to use: paste **Prompt G (global)** first in every Stitch project, then one screen prompt at a time. Do not ask Stitch for the whole ERP at once. Every prompt ends with the same guard line so Stitch does not invent features.

---

## 1. Design system (Deliverable 8)

**Identity.** Keep the existing green and brass family so the redesign feels like the same business. Logo: the existing monogram (upright R on a rounded tile with a small sun), refined — tile `#173A29`, R `#F7F1E3`, sun `#D4A24E`; wordmark "Ravinarayan" with "ERP" in small caps beside it. Orange `#C9501C` is the delivery app only; never use it in the ERP.

| Token | Value | Use |
|---|---|---|
| Primary green | `#173A29` | sidebar, primary buttons, login hero |
| Green 700 / 500 | `#1F4D37` / `#2E7650` | hover, links, focus ring |
| Green 100 / 50 | `#DDEBE2` / `#F1F7F3` | selected rows, soft fills |
| Brass accent | `#C89F6B` | single accent: active marker, key figure underline |
| Background | `#F6F5F0` | page |
| Surface | `#FFFFFF` | cards, tables |
| Border | `#E3E1D8` | 1 px hairlines |
| Text primary / secondary / muted | `#1A2E20` / `#4B5A50` / `#7A857D` | |
| Success / Warning / Error / Info | `#2E7650` / `#B7791F` / `#B42318` / `#2B6CB0` (each with a 10% tint background and AA-contrast text) | |

**Typography.** Headings: a refined serif (e.g. Fraunces or Source Serif 4) at 24/20 only for page titles; everything else a clean sans (Inter), 14 px body, 12 px labels, tabular numerals for all money and counts. Money always `₹12,500` with Indian grouping.

**Layout.** 8-pt grid. Desktop: 240 px sidebar (collapsible to 72), top bar 56 px with search, Live indicator, bell, profile. Content max width 1280, 24 px gutters. Tablet: sidebar collapses to icons. Phone: 16 px gutters, bottom bar (5 items), sheets rise from the bottom and cover the full screen height with a drag handle.

**Components.**
- Buttons: pill radius 999; primary solid green, secondary outlined, quiet text, danger red outline (solid only inside confirm). One primary per view. Min height 40 desktop, 44 touch.
- Inputs: 40 px, 10 px radius, label above, helper/error below in 12 px. Custom select menu (no native dropdown).
- Tables: sticky header, 48 px rows, right-aligned numerics, row hover, click row opens a right drawer, sortable headers, pagination 25/50, column chooser only where >7 columns. Phone: rows become stacked cards with the same fields.
- Cards: 12 px radius, 1 px border, no shadow; only 3 per row maximum; stat figures not boxed unless they drill down.
- Badges: soft tint pill, text only (no icons) — Delivered, Partly, Out, Waiting, Cancelled, Paid, Part paid, Unpaid.
- Drawers (right, 480 px) for record details and edits; modals only for confirmations; bottom sheets on phones.
- Charts: single-hue green with brass for the comparison series, direct labels, no gridline clutter, tooltip on hover/tap, always with a "View records" link.
- Empty states: one illustration-free line, one sentence of why, one primary action. Loading: the scooter loader for full pages, skeleton rows for tables.
- Motion: 150–200 ms ease-out, fade/slide only; respects reduced motion.
- Accessibility: AA contrast, visible focus ring, aria-current in nav, keyboard sheets with Escape.

**Interaction conventions.** Confirm only destructive or irreversible (reverse, cancel, finalise closing, check-out). Success = toast bottom-left plus the record updated in place. Errors = plain sentence ("Couldn't save. Check your connection and try again.") with the entry preserved. Never show technical codes.

---

## 2. Stitch prompts (Deliverable 9)

### Prompt G — global (paste first)
```
Design a premium, calm enterprise web app called "Ravinarayan ERP" for a paying-guest house and tiffin (home-meal) delivery business in India. Green-led identity: primary #173A29, mid green #2E7650, soft green #F1F7F3, brass accent #C89F6B (used sparingly), page background #F6F5F0, white surfaces, hairline borders #E3E1D8, text #1A2E20. Fonts: Inter for UI, a refined serif only for page titles. Money in ₹ with Indian grouping and tabular numerals. Desktop layout: 240px dark-green sidebar with grouped navigation (Home, Operations, Customers, Property, Money, Insights, Admin), 56px top bar with search, a small "Live" status dot, notification bell and profile avatar. Content max-width 1280px, 24px gutters, 8pt spacing, 12px card radius with 1px borders and no shadows, pill-shaped buttons (one solid primary per view), 40px inputs with labels above, tables with sticky header and 48px rows and right-aligned numbers, soft-tint text-only status badges, right-side 480px drawers for record details, modals only for confirmations. No gradients, no glassmorphism, no decorative illustrations, no fake charts. Provide matching responsive tablet and phone versions (bottom navigation on phone, full-height bottom sheets). Use only the content and actions I specify in each screen request; do not invent extra menu items, metrics or features.
```

### Auth
**P1 Login.** `Screen: Sign in. Full-height green (#173A29) hero on the left (desktop) with the Ravinarayan monogram logo, product name and one line "Run the house and the kitchen from one place"; right side a white card with: Username or email, Password with show/hide, a "Forgot password?" link, one pill button "Continue". On phone the hero collapses to a short green header. No other links, no version text, no debug info.` Variants as separate prompts: **P1a** inline field errors ("Enter your username", "Enter your password"); **P1b** wrong password banner ("Those details don't match."); **P1c** button loading with scooter loader; **P1d** code step: six-digit field, "Resend code in 0:45", "Use a different account", error "That code is wrong. 2 tries left."; **P1e** inactive account ("This account is switched off. Ask the owner."); **P1f** network failure ("Can't reach the server. Check your connection."); **P1g** session expired notice above the form.

### Dashboard
**P2 Dashboard (Owner/Manager).** `Top: page title "Today", date, division switch (Combined | PG | Tiffin), "Export report" button. Row 1 'Today's deliveries': Waiting, Out, Delivered of Total with a thin progress bar and %, Problems, Cash with drivers — five compact figures, each clickable. Row 2: Meals expected (Lunch, Dinner), Occupancy % with Vacant beds and Active residents, Residents with dues (count and ₹ total). Row 3: Money this month — Collected, Expenses, Net, Cash in hand, and a banner 'Yesterday's cash is not closed' only when true. Charts: Collected vs Expenses (6 months, green and brass), Daily collections (30 days), Delivery completion % (14 days), Expenses by category (horizontal bars). Right column: Needs attention list (max 6): exceptions, unassigned stops, handovers waiting, subscriptions ending soon — each links to its record. Every figure has a 'View' drill-down.` States: **P2a** loading skeleton; **P2b** one section failed (inline notice "Couldn't load deliveries. Retry."); **P2c** new business with no data.

### Orders and Delivery
**P3 Orders list.** `Title Orders, date picker, search customer/phone, filters Delivery state and Payment state, primary 'New order'. Table: Time, Customer, Phone, Type (Delivery/Dine-in), Items summary, Total ₹, Delivery state badge, Payment badge with pending ₹, Driver. Row opens a right drawer with items (ordered / delivered / reason), payments, event timeline. Empty: 'No orders for this day' with New order. Below table: collapsible 'Subscriptions today' with per-subscription Skip / Add extra.`
**P4 New order sheet.** `Right drawer / phone full sheet. Step 1 toggle Delivery | Dine-in. Customer search by name or phone with 'Add new customer' inline (name, phone, address); last 5 orders with 'Reuse'. Menu grid grouped by category with +/− steppers and live total. Address and notes (delivery). Footer: total and 'Place order'. States: saving, duplicate phone message, menu empty ('No menu items. Add them in Tiffin products').`
**P5 Delivery board.** `Tabs Board | Problems | Cash custody | History. Board: date, meal toggle Lunch | Dinner, status filter chips with counts, search, 'Assign selected to [driver]' bulk bar when rows are ticked, 'Export day'. Table: checkbox, Customer, Address, Items, Driver, Status badge, Amount due. Row opens the stop panel (right drawer) with timeline, items delivered/undelivered with reasons, payment, and actions Assign/Reassign, Retry, Cancel (reason required, cut-off override warning), Resolve, Collect payment.` Separate prompts: **P5a** Assign dialog; **P5b** Cancel confirmation; **P5c** Problems tab (undelivered qty, reason, where it went, Resolve); **P5d** Cash custody (per driver: collected, handed over, pending, declared handovers with Accept); **P5e** History with driver and date range filters and per-driver summary line; **P5f** empty day with 'Prepare today's deliveries'.

### Customers
**P6 Residents list.** `Search, filters Status and Floor, 'Check in resident'. Table: Name, Phone, Room, Check-in date, Rent, Dues ₹ (red when >0), Status. Row opens profile page.` **P7 Resident profile.** `Header: name, phone, room, status badge, actions Edit, Transfer, Check out. Tabs: Overview, Payments, Stay history, Documents, Settlement. Overview shows Rent, Deposit, Dues, next due. Payments: ledger with Record payment, Record charge. Documents: KYC list with Upload.` Prompts: **P7a** Check-in sheet; **P7b** Transfer sheet; **P7c** Check-out settlement preview (dues, deductions, deposit applied, refund) with confirm; **P7d** Record payment sheet; **P6a** empty residents.
**P8 Tiffin customers.** `Directory with Search, Status filter, 'Add customer'. Table: Name, Phone, Type, Diet, Active subscriptions, Balance. Profile drawer: details, subscriptions list, invoices, payments.` **P9 Subscription form.** `Customer, Product, Meal types Lunch/Dinner/Both, Service days, Quantity per meal, Start date, End date, Price, Delivery address, Instructions. Actions Pause (dates, reason), Resume, Cancel (reason).` **P10 Tiffin billing.** `Period picker, preview table per customer (days, amount), 'Generate invoices', exceptions list.`

### Property
**P11 Rooms.** `Search, floor filter, 'Add room'. Grid of room tiles grouped by floor: number, type, occupied/capacity, rent, status. Click opens drawer with occupants, edit, deactivate.` Prompts **P11a** room form; **P11b** deactivate blocked message ('2 residents live here').

### Kitchen (only after owner confirms)
**P12 Kitchen today.** `Date, Lunch | Dinner, Demand breakdown (residents, subscribers, party orders, opt-outs = planned portions), plan status Draft/Confirmed/Completed with actions, prepared vs delivered reconcile, 'Print prep sheet'.` **P13 Stock.** `Materials table with quantity, unit, last receipt; actions Receive, Waste, Adjust; movement history.` **P14 Recipes.** `Recipe list, ingredient quantities per portion, consumption preview/confirm.`

### Money
**P15 Cashbook.** `Period selector, division tabs Combined | PG | Tiffin, summary figures (Money in, Money out, Net, Cash in hand), filter by type and method, table: Date, Type, Party, Method, Reference, In/Out amount, Status; actions Record payment, Record expense (Managers and Owner); Reverse (Owner only, reason).` Prompts: **P15a** Record expense sheet with receipt upload; **P15b** Reverse confirmation; **P15c** locked-date message ('This day is closed. Ask the Owner to reopen it.').
**P16 Resident dues.** `Table of residents with Billed, Paid, Due, Last payment; click for statement.` **P17 Invoices.** `Invoice list with number, customer, total, paid, status; draft/issue/allocate/cancel; printable invoice view.` **P18 Daily closing.** `Date, per-division expected cash, physical count input, variance with required reason, Save draft, Finalise (confirm), Reopen (Owner).`

### Insights and Admin
**P19 Reports.** `List of reports (names listed in the spec) with date range, division, 'View' and 'Export CSV'; preview table with totals.` **P20 Activity log.** `Filters User, Action, Date range; table When, Who, What, Record, Result; row opens drawer.` **P21 Staff.** `Directory with role badges and Active/Off status, KPI strip, 'Add staff'; drawer: change role, switch off, reset password, history.` Prompts **P21a** Add staff; **P21b** switch-off confirmation. **P22 Settings.** `Sections Business details, Meal times and cut-off, Default delivery partner, Notifications; each with Save.` **P23 Account.** `Profile, Change password (live checklist), Change email (codes to both inboxes), Signed-in devices, Sign out.` **P24 Notifications panel.** `List grouped Today/Earlier with severity dot, text, time, 'Mark all read'; each item links to its record.` **P25 System pages.** 404, error, offline, no access — one sentence and one button each.

**Guard line (append to every screen prompt):** `Use only the fields, actions and states listed above. Do not add menu items, KPIs, charts, data columns or features that are not listed. Follow the global design system exactly.`
