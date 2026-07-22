# UI/UX redesign brief — paste this to Claude

> Copy everything below the line into a new Claude conversation.
> Attach 5–10 screenshots of the current app (dashboards for store, kitchen
> and F&B, the orders list, an order detail page, and the new-order form).

---

You are redesigning the UI/UX of a catering ERP that is **live in production
with a real team using it every day**. I need a complete design system and
screen-level redesign that I can hand to an engineer to implement.

## The product

"Greenpath" (indefine-kitchen) — an operations system for a catering and
banquet business in Bangalore, India. It runs the whole order lifecycle:
a sales enquiry becomes an order, a manager and the chef approve it, the
chef raises an ingredient requisition, the store issues stock or raises a
purchase order, the kitchen cooks, the food is delivered or served, then
accounts invoices and collects payment.

## Who uses it

Ten roles, on very different devices and in very different conditions:

| Role | Where they work | Device |
|---|---|---|
| Admin, Manager | Office | Desktop |
| Sales | Office / on the move | Desktop + phone |
| Accounts | Office | Desktop |
| **Kitchen head (chef)** | Hot, busy kitchen | Phone, often one-handed |
| **Store keeper** | Storeroom, counting stock | Phone |
| **F&B service** | Banquet floor, during events | Phone |
| Delivery driver | On the road | Phone |
| Housekeeping, Maintenance | On site | Phone |

The kitchen, store, F&B and delivery people are the heaviest users and the
least tolerant of clutter. They are not office workers, they are often
standing, moving, in a hurry, sometimes with wet or greasy hands. Some are
not confident with software. **If a screen needs reading twice, it has
failed.**

## What's wrong today

1. **It looks like a typewriter.** IBM Plex Mono is used in 465 places —
   order codes, dates, money, quantities, IDs. The whole app reads as a
   terminal printout. It feels cold, technical and old.
2. **Dense and flat.** Long full-width rows of small text. Everything has
   the same visual weight, so nothing stands out. Users scan the same row
   three times to find the date.
3. **No sense of urgency.** An event tomorrow looks identical to one next
   month. Staff miss urgent jobs.
4. **Forms are full page navigations.** Creating an order means leaving the
   list, filling a long page, and coming back. Users lose their place and
   their context.
5. **Lifeless.** No warmth, no motion, no feedback. It feels like data
   entry, not like a tool that helps you.
6. **Too many buttons in headers.** Users get confused about what to press.

## What I want

Make it **lively, clean, friendly and calm** — soft rounded corners,
generous spacing, clear hierarchy, a warm and modern feel. It should look
like a well-designed 2026 product, not an accounting package. But it must
stay **fast to scan and unambiguous** — this is a working tool, not a
marketing site. Delight comes from clarity, not decoration.

Specifically:

- **Pop-up / modal forms.** Creating and editing (orders, items, requisition
  lines, customers) should open in a modal or side sheet over the current
  screen, so the user never loses context. Tell me exactly when to use a
  centre modal vs a side sheet vs a full page, and how each behaves on a
  phone (bottom sheet? full-screen takeover?).
- **Curved edges** throughout — define the exact radius scale.
- **Retire the monospace font** for anything that isn't a code or a
  reference number. Important: money columns and quantity columns still need
  to align vertically in tables — solve that with tabular numerals
  (`font-variant-numeric: tabular-nums`) on a proportional font, not by
  reaching for mono. Tell me the one or two places, if any, where mono
  genuinely still earns its keep.
- **Dates must dominate.** Every job is tied to an event date. Today,
  Tomorrow, This week and Overdue must be obvious at a glance, from across a
  kitchen, without reading.
- **Card-based layouts** in multi-column grids rather than full-width rows,
  with the urgent items first.

## Technical constraints — please respect these

- **Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS,
  shadcn/ui-style components, `sonner` for toasts.** Give me Tailwind
  classes and CSS custom properties, not Figma-speak.
- The design system lives in `globals.css` (CSS variables) and
  `tailwind.config.ts`. I want to **evolve these tokens, not throw them
  away** — a redesign I can roll out progressively, screen by screen,
  without a big-bang rewrite that breaks production.
- Forms use server actions and already return friendly error messages; the
  design needs clear **loading, empty, error and success** states for both
  modals and inline actions.
- **Indian conventions**: ₹ with lakh/crore grouping (₹1,32,000), dates as
  "Wed 17 Jul", 24-hour times, GST on invoices.

## Current palette — keep the spirit, refine as needed

It's a warm, paper-and-green identity that the owner likes. Keep the warmth
and the emerald; modernise the rest.

```
--ik-paper:       #FAF6EE   /* warm paper background */
--ik-card:        #FFFFFF
--ik-ink:         #20251F   /* primary text */
--ik-ink2:        #6E7268   /* secondary */
--ik-ink3:        #A9ADA3   /* tertiary */
--ik-rule:        #EAE2D2   /* borders */
--ik-accent:      #166534   /* action emerald */
--ik-alert:       #B42318   /* overdue / destructive */
--ik-amber:       #B54708   /* due soon / warning */
--ik-info:        #185FA5
--ik-gold:        #B5882E   /* decorative */
--radius:         0.625rem  /* current: 10px buttons, 14px cards */
```

Fonts today: Inter (UI), Fraunces (display), IBM Plex Mono (overused).

## What I want back

1. **Design principles** — 5 or 6 rules specific to this product, each
   justified by how these users actually work.
2. **Token spec** — full colour scale (including semantic urgency colours),
   type scale, radius scale, spacing scale, shadow/elevation scale, motion
   durations and easings. As CSS custom properties + Tailwind config,
   ready to paste. Include dark mode only if you think it's worth it for
   these users, and say why.
3. **Typography** — which typeface(s), which weights, and the rule for
   numerals. Justify the choice for a hot kitchen at arm's length.
4. **Component specs** — button hierarchy, card, badge/pill, modal, side
   sheet, bottom sheet, form field, select/combobox, table, empty state,
   toast, urgency indicator, nav. For each: anatomy, sizes, states, and the
   Tailwind classes.
5. **Screen redesigns**, as annotated layout descriptions or HTML/JSX
   mockups, for these six:
   - **Store keeper dashboard** — chef requests, F&B requests, purchase
     orders to act on
   - **Chef dashboard** — today's and tomorrow's orders, cooking jobs
   - **Orders list** and **order detail** (long status pipeline, role-
     specific actions in a sidebar)
   - **New/edit order** as a modal or sheet, including the menu-item picker
   - **Requisition issuing screen** — line by line: issue full, issue
     partial, raise a PO, or cancel with a reason
6. **The modal system** — when to use which container, sizes, scroll
   behaviour, how a long form behaves on a 360px phone, focus management,
   and how validation errors surface inside a modal.
7. **Accessibility** — minimum touch target sizes for kitchen use, contrast
   ratios (AA minimum), focus rings, and never using colour alone to signal
   urgency.
8. **Motion** — a restrained set. Where transitions genuinely help
   comprehension, and where they'd just slow a busy user down.
9. **Rollout order** — which changes give the biggest perceived improvement
   for the least risk, so I can ship this progressively to a live system.

Ask me anything you need about the workflows before you start. Where you
make a judgement call, say what you decided and why — I'd rather have one
opinionated, coherent system than a menu of options.
