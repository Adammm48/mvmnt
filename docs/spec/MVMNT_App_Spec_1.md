# MVMNT App — Product & Technical Spec

**Version:** 1.2 · **Prepared by:** Adam Elbasiony, Founding CTO
**Contact:** [business email or website — add here]
**Purpose:** Build-ready spec for the MVMNT run club app (iOS + Android).

---

## 0. Instructions for the Build Agent

This spec is paired with a companion file, `MVMNT_Engineering_Principles.md` — read and follow both together. The principles doc governs *how* to build (simplicity, single source of truth, security, privacy, testing depth, definition of done); this spec defines *what* to build.

Build this in phases, one at a time — don't start the next phase until the current one is working and I've confirmed it. Use the stack and rationale in Section 12 as fixed decisions; don't re-litigate them.

For any consequential or hard-to-reverse decision within a phase (data model changes, security-sensitive flows like the QR friend system, the live-location approach), run it through /llm-council before implementing, and tell me the outcome. At the end of all phases, run /llm-council once on the whole system as a final review.

For routine implementation choices, pick the most suitable option for an app with ~300 people day-to-day, but occasional single events up to ~2,500 (see Section 1) — flag anywhere that gap could cause a burst-load problem (concurrent writes, live-location connections, notification fan-out) so it can be reviewed specifically, rather than optimizing everywhere for the peak number by default.

Ask directly if anything in this spec is ambiguous, missing, or contradictory before guessing.

---

## 1. Overview

MVMNT runs weekly sessions typically drawing 300+ people — one event reached 2,500 attendees — currently coordinated through WhatsApp, Instagram and word of mouth. This app replaces that with a single cross-platform product (iOS + Android) covering sign-ups, live run tracking, a public leaderboard, a QR-gated friends system, sponsor placements, a merch shop, an event-driven notification system, and a full admin console that requires no developer involvement to run day-to-day.

**Design intent:** every screen should feel warm, low-friction and motivating rather than clinical or performance-obsessive — see Section 2.

---

## 2. Design Philosophy — Psychology-Driven UI/UX

The goal is an app that makes people *want* to tap "join," not one that just lets them. Three psychological levers matter most here:

**1. Color and arousal.** Warm hues (red, orange) physiologically raise perceived energy and urgency — good for primary CTAs like "Join This Run" or a live countdown, but overused they read as alarming or aggressive. Cool hues (blue, teal) read as trustworthy and calm — good for stable chrome (nav bars, profile, settings) so the app doesn't feel exhausting to sit in. Green sits in between: strongly associated with health, growth and "go/success," which makes it the natural color for confirmations (checked in, goal hit, points earned).

**Recommended palette:**

| Role | Color | Reasoning |
|---|---|---|
| Primary action / energy accent | Coral-orange `#FF5A36` | Warm, high-arousal, reads as "go" without the aggression of pure red — used only for primary CTAs (Join, Check In, Sign Up) so it stays special |
| Success / confirmation | Signal green `#3DDC84` | Universally reads as "done," "healthy," "on track" — check-ins, streaks, points earned |
| Base / trust | Deep charcoal-navy `#1B1F2A` | Calm, premium background that doesn't compete with the accent colors; avoids the fatigue of pure black on long scrolling sessions |
| Neutral surface | Warm off-white `#F7F5F2` | Slightly warm rather than clinical white — softer on the eyes, feels friendlier |
| Secondary accent | Sunshine yellow `#FFC93C` — used sparingly | Optimism and reward — badges, streak flames, gift-highlight moments. Overusing yellow reads as anxious, so cap it at small highlight elements |

Avoid saturated red as a primary color — in a fitness context it reads closer to "stop / warning" (heart-rate zones, errors) than "encouragement," so it's reserved for genuine alerts (e.g. "run cancelled," "waitlist closing").

**2. Friction and the "one clear next step" rule.** Every screen should have exactly one obviously-primary action (usually the coral CTA), with everything else visually secondary. Sign-up should be reachable in one tap from the home screen — no nested menus. Check-in on run day should work even one-handed, glove-on, low-signal (large tap target, works offline and syncs later).

**3. Social proof and momentum, not shame.** Streaks, badges and the leaderboard should always frame progress positively (“3 more runs to Elite” rather than “you missed 2 runs”). Public numbers (runners going, friends attending) create a bandwagon effect that genuinely increases sign-ups — lean into "312 people are already in" rather than hiding low early numbers.

**Typography & tone:** rounded, friendly sans-serif (e.g. SF Pro Rounded) for anything encouragement-facing; a slightly more structured weight for data (leaderboard numbers, stats) so it still reads as credible, not childish.

**Motion:** small celebratory micro-animations on check-in / points earned (confetti burst, a subtle pulse) — costs little, meaningfully increases the "that felt good" reaction that drives repeat use.

---

## 3. Core User Flows

1. **Discover → Sign up → Reminder → Check in → Auto "in" status → Run happens → Notified when photos are ready → Leaderboard/points update**
2. **Add a friend:** Friend A shows their personal QR code (from their own phone) → Friend B scans it in person → friend request auto-accepted (no remote add possible) → both can now see each other's in/out status and poke each other
3. **Admin:** logs into the admin console → creates a new run (date, time, meeting point) → draws the route on the map → publishes → app auto-fires the "new run" notification to all members
4. **Sponsor cycle:** admin adds a sponsor → attaches it to a run or a banner slot → app tracks impressions/taps → admin exports simple performance numbers
5. **Merch + gift:** member browses shop → adds item → chooses "Gift to a friend" → picks recipient from friends list (added via QR only) → pays → recipient gets a notification with a redemption/delivery flow

---

## 4. Feature Specs

### 4.1 Run Sign-Up & Check-In
- Each run has: title, date/time, meeting point, distance, pace group(s), capacity, waitlist toggle
- Members tap "Join" → added to attendee list → auto-reminder scheduled
- **Check-in** on the day (QR at the meeting point, or geofenced auto-detect) marks the member "in" for that run
- A member is publicly shown as "in" once they've signed up **and** checked in, *or* if they check in directly without a prior sign-up
- Members can remove their own "in" status at any time before the run starts

### 4.2 Public Leaderboard
- Global, open to all members — not friends-scoped
- Ranks by points (see Loyalty, 4.3) over a selectable window (this month / all-time)
- Always frames position positively — show "X pts to next rank" rather than negative deltas

### 4.3 Loyalty Program
- Points per check-in, streak bonuses, milestone badges (e.g. 50 / 100 / 250 runs)
- Tiers (Starter → Core → Elite) unlock priority sign-up windows and merch discounts
- Points redeemable at checkout in the merch shop

### 4.4 Friends System
- **Add friend:** only via scanning a QR code the other person actively shows from their own phone, in person — no search, no remote add, no username lookup. This is a deliberate safety measure against unsolicited adds/harassment.
- **Friends list:** shows each friend's in/out status for the next run
- **Poke:** a lightweight nudge sent to a friend about a specific upcoming run (see Section 9 for open options — mechanic not yet finalized)

### 4.5 Sponsor Integration
- Sponsor entities: name, logo, linked URL, active date range
- Placement types: home banner, "presented by" run badge, push-notification sponsor mention
- Basic reporting: impressions, taps, redemptions per sponsor, exportable by admin

### 4.6 Merch Shop
- Product catalogue: current stock + "coming soon" items with a notify-me waitlist
- Standard checkout with loyalty-point discounts applied automatically
- **Gift to a friend:** at checkout, buyer can choose "This is a gift," select a recipient from their QR-added friends list, add an optional short message, and the recipient receives a notification + in-app redemption flow (size confirmation for apparel, delivery address, etc.) rather than the item just appearing anonymously

### 4.7 Route & Live Location
- Admin draws or selects the full route directly on an in-app map and publishes it per run (no external GPX needed)
- During the run, members can optionally share live location so friends/leaderboard-followers can see progress start to finish
- Distance/pace calculated in meters, modeled on PaceFyndr's approach; optional pull from Apple HealthKit (steps, heart rate) with explicit permission

### 4.8 Photo System
- Short-term: replicate the current Google Drive category structure (pre-run / run / after / camera) as in-app galleries
- Target: AI selfie face-matching (à la AlphaX-style race photo tools) — member takes a selfie once, app surfaces every photo of them across the event automatically
- Photos-ready notification fires once an event's gallery is published

### 4.9 Admin Console
Must be fully operable by MVMNT's own non-technical admin with zero developer involvement post-handover:
- Create/edit/cancel runs, draw and publish routes
- Compose and send notifications (manual + scheduled)
- Upload/manage photos and videos, publish galleries
- Manage sponsors and placements, view basic reporting
- Manage merch catalogue and stock
- View member list, leaderboard, and moderation tools (remove a member, disable a QR code if abuse is reported)

---

## 5. Data Model (key entities)

- **User** — id, name, profile photo, loyalty tier, points, health-data opt-in, personal QR code
- **Run** — id, title, datetime, meeting point, route (polyline), distance, capacity, sponsor(s), status
- **Attendance** — user_id, run_id, signed_up (bool), checked_in (bool), public_status ("in"/"out"), timestamp
- **Friendship** — user_id_a, user_id_b, created_via ("qr_scan"), created_at
- **Poke** — from_user_id, to_user_id, run_id, created_at
- **Sponsor** — id, name, logo, url, active_from, active_to
- **Placement** — sponsor_id, run_id (nullable), type (banner/badge/push), impressions, taps
- **Product** — id, name, price, stock, status (in_stock/coming_soon), waitlist_count
- **Order** — id, buyer_id, product_id, is_gift (bool), recipient_id (nullable), message (nullable), status
- **Gallery** — run_id, category (prerun/run/after/camera), status (draft/published)
- **Photo** — gallery_id, url, matched_user_ids (for AI face-match, once built)
- **Notification** — type, audience, run_id (nullable), sent_at

---

## 6. Notification Catalog

| Trigger | Audience | Example copy |
|---|---|---|
| New run/event published | All members | "Saturday 6K just dropped — grab your spot" |
| Route/plan published | Attendees of that run | "The route for Saturday's run is live" |
| Reminder (night before / morning of) | Signed-up attendees | "Tomorrow, 07:00 — Saturday 6K. See you there" |
| Run started | Attendees + friends of attendees | "The run has started" |
| Run ended | Attendees | "Nice work — that's a wrap" |
| Photos ready | Attendees of that run | "Your photos from Saturday are ready" |
| Sponsor/venue shoutout | All members or targeted segment | "Presented by [Sponsor] — today's run" |
| Friend poke | Target friend | "[Name] wants you to join Saturday's run" |
| Friend checked in / marked "in" | Friends list | "[Name] is in for Saturday" |
| Gift received | Recipient | "[Name] sent you a gift from the MVMNT shop" |
| Waitlist spot opened | Waitlisted member | "A spot opened up for Saturday's run" |
| Milestone/badge earned | That member | "100 runs — Elite tier unlocked" |

---

## 7. Screens (reference list)

Home · Run Detail · Sign-Up/Check-In · Live Route/Tracking · Leaderboard · Friends List · Add Friend (QR scan/show) · Profile & Loyalty · Merch Shop · Product Detail · Gift Flow · Gallery/Photos · Notifications Center · Admin: Run Editor · Admin: Route Drawer · Admin: Notification Composer · Admin: Sponsor Manager · Admin: Merch Manager · Admin: Member/Moderation

---

## 8. Privacy & Compliance Notes

- **Live location:** requires clear in-app purpose messaging and, if tracked in the background, a specific App Store privacy justification; battery impact should be communicated to users.
- **HealthKit data:** requires Apple entitlement approval and an explicit, specific permission prompt (not a blanket "allow health access").
- **AI face-matching photos:** this is biometric data under UK/EU GDPR — needs explicit opt-in consent, a clear explanation of how face data is stored/processed, and a straightforward way to delete a face profile and any matched photos.
- **QR-based friend adding:** by design this avoids a searchable directory of members, which is good for harassment prevention — make sure the QR code can be regenerated/invalidated by a user if they're worried it's been shared without consent.
- **Under-18 members:** if the club has minors attending family-friendly runs, consider whether any profile/photo/leaderboard visibility needs additional guardrails.

---

## 9. Open Question — The "Poke"

Not yet decided. A few directions to choose between:

1. **Simple nudge:** a push notification only ("Adam wants you to join Saturday's run") — lowest effort, lowest risk of feeling spammy.
2. **Visible social nudge:** the poke also shows up on a shared "who's talking about this run" feed, so it doubles as light social proof for the run itself, not just a 1:1 ping.
3. **Reciprocal streak:** poking a friend who then signs up earns both of you a small points bonus — turns the poke into a lightweight referral/growth loop rather than just a social gesture.
4. **Poke limits:** cap pokes per day per friend (e.g. one per run) so it can't become a harassment vector in its own right — worth having regardless of which direction is chosen.

Recommend starting with option 1 (simplest, safest) and layering 3 in later if you want it to double as a growth mechanic.

---

## 10. Build Phases

1. **Phase 1 — Core:** Sign-up, check-in, run detail, notifications (new run, reminder, run started/ended), admin run editor
2. **Phase 2 — Community:** Leaderboard, friends system (QR add, in/out list, poke v1), loyalty points/tiers
3. **Phase 3 — Commerce:** Merch shop + gift flow, sponsor placements + reporting
4. **Phase 4 — Routes & Media:** Route drawing + live tracking, photo galleries (Drive-style categories first)
5. **Phase 5 — Advanced:** HealthKit integration, AI selfie face-matching for photos

---

## 11. Open Items Needing MVMNT's Input

- Final go-ahead to submit under MVMNT's name on the App Store (App Store Connect account ownership, business entity, legal liability)
- Current sponsor agreements and merch catalogue/pricing, to replace placeholder data
- Whether any current members are minors, affecting privacy defaults

---

## 12. Engineering Addendum — Chosen Stack

| Layer | Choice |
|---|---|
| Mobile app | React Native via Expo (dev-client/prebuild workflow, not managed Expo Go, to allow HealthKit/Health Connect access) — single codebase targeting **both iOS and Android** |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, Edge Functions |
| Admin console | Separate React web app, same Supabase backend |
| Maps (mobile) | react-native-maps (renders as Apple Maps on iOS, Google Maps on Android — same underlying route data, different look per platform) |
| Route drawing (admin) | Mapbox GL JS or Google Maps JS API in the web console |
| Push notifications | Expo Push Notification service → APNs (iOS) + FCM (Android) |
| Health data (Phase 5) | HealthKit on iOS, Health Connect on Android — two separate integrations, no shared code between them |
| AI photo face-matching (Phase 5) | Managed recognition API (e.g. AWS Rekognition) called from a Supabase Edge Function — not built in-house; platform-agnostic since it runs server-side |

**Why React Native/Expo over native Swift/SwiftUI:**
- Directly reuses JavaScript/HTML/CSS already known, rather than starting Swift from zero
- Faster iteration loop when handing build work to an AI coding agent — the ecosystem is heavily represented in training data and documentation, so an agent moves faster and makes fewer mistakes here than in Swift
- Cross-platform is essentially free — an Android release later costs little extra, even though only iOS is needed now
- Honest tradeoff: if the longer-term goal were specifically "iOS/Swift engineer" as a career signal, native Swift would be the stronger individual skill investment. For a free project that needs to ship fast alongside coursework and other builds, React Native is the pragmatic call — the CV signal here is "shipped a real product used by 300+ people," which doesn't depend on the language.

**Why Supabase over a custom backend:**
- Already in active use — no new tool to learn
- Its relational Postgres model maps directly onto the data model in Section 5 (Users, Runs, Attendance, Friendship, etc.) with no translation layer
- Built-in Auth supports Sign in with Apple, which the App Store effectively requires if other social logins are offered
- Storage replaces the current Google Drive folder workflow directly
- Realtime subscriptions are the natural fit for live location sharing and a live-updating leaderboard
- Edge Functions handle notification triggers and business logic without standing up and maintaining a separate server
- Free tier is generous enough for a free community project at this scale

**Why a separate web admin console, not a mode inside the mobile app:**
- The admin needs to run the app with zero developer involvement — a browser dashboard is easier for a non-technical admin to reach (any laptop, no install) than a hidden mode inside the consumer app
- Changes to admin tooling ship instantly — no App Store review cycle
- Reuses the same React/Supabase skills as the mobile app, so it's genuinely one skill set powering two front-ends, not two separate stacks to maintain

**Known friction points with this stack:**
- HealthKit/Health Connect is not reachable from the plain managed Expo Go workflow — needs the dev-client/prebuild setup from the start of Phase 5 (or earlier, if worth doing on day one to avoid a later migration)
- AI face-matching should be treated as a "buy," not "build" — a managed recognition API is the sane choice over a custom model

**Cross-platform friction points (iOS + Android, worth knowing before build starts):**
- **Two developer accounts, two owners.** Apple Developer Program ($99/yr) and Google Play Console ($25 one-time) both need to be owned by MVMNT, not Adam — the same App-Store go-ahead issue applies to both stores.
- **Two review pipelines, different rhythms.** Apple review typically takes 1–2 days; Google's can be faster for routine updates but applies a more detailed policy review to apps requesting background location — factor both timelines into any launch date.
- **Background location is stricter on Android, not looser.** Google Play requires a prominent in-app disclosure and a demo video in the Play Console submission for apps requesting background location. Recommend scoping live tracking to **foreground-only, while a run is active** — that covers the real use case and avoids this requirement (and its Apple equivalent) entirely.
- **Health data is two integrations, not one.** HealthKit (iOS) and Health Connect (Android) share no code — budget Phase 5 as two small builds, not one.
- **Push notifications need two credentials.** Expo's push service abstracts the sending, but Apple Push certs and a Firebase project (FCM) both need to be created — ideally under MVMNT's ownership if they're meant to hold the accounts long-term.
- **Maps look slightly different per platform** by design (Apple Maps vs Google Maps rendering) even though the underlying route data is identical — not a bug, just don't expect pixel-identical screenshots across platforms.
- **Wider QA surface on Android** — far more device sizes, OS versions and manufacturer quirks to test against than iOS's narrower device set.

**Peak-load note (300 typical, up to 2,500 at a single event):** design for ~300 as the normal case, but load-test the burst-prone paths specifically before a large event: concurrent check-ins/sign-ups in a short window, simultaneous live-location connections over Realtime, and notification fan-out to thousands of devices at once. This is a peak-handling problem, not a reason to over-build for 2,500 as the everyday baseline.

---

## 13. Estimated Operating Costs

Separate from build effort — this is what it costs to actually keep the app running, based on current (2026) pricing. Useful for deciding who covers hosting long-term.

**One-time / setup:**
| Item | Cost |
|---|---|
| Apple Developer Program | $99 (then $99/year, recurring) |
| Google Play Console | $25 one-time (no renewal) |
| Domain name for admin console (optional) | ~$12/year |

**Recurring:**
- **Supabase:** free tier (500MB DB, 1GB storage, 50K MAU) is too small once photo/video galleries are in real use — realistically **Pro at $25/month** from early on, which covers 100GB storage / 250GB bandwidth.
- Admin console hosting (Vercel/Netlify) and push notifications (Expo → APNs/FCM): free at this scale.
- Maps (Mapbox/Google Maps free tier): free at this usage level.

**Usage-based:**
- AI face-matching (AWS Rekognition): ~$0.001/image processed: at roughly 1,200 photos/month (4 runs × ~300 photos), a few dollars a month; largely covered by AWS's first-year free tier.

**Realistic total:** roughly **$450–600 in year one**, then **~$400–450/year** after — mostly the Supabase Pro subscription plus the Apple renewal.

**Peak-event caveat:** these figures assume the ~300-person weekly baseline. A 2,500-person event will spike Realtime connections, database writes, and notification sends for that day — worth checking Supabase's current Realtime concurrent-connection limits against that number before a big event, and budgeting for a possible temporary plan bump around large events rather than sizing the whole year's plan for the peak.
