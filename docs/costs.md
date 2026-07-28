# MVMNT — What the app costs to run

Prepared for the club owner. Covers everything from launch through all five
planned phases.

**All figures in USD.** Apple, Google, Supabase and Expo all bill in dollars, so
the EGP cost moves with the exchange rate — convert at the rate on the day.

> **Read this first.** Prices below were correct when written and are checked
> against each vendor's public pricing. Vendors change pricing, and two items —
> the Egyptian payment gateway and AI photo matching — genuinely cannot be
> priced without a quote. Those are marked **[NEEDS A QUOTE]** rather than
> guessed at, because a made-up number in a budget is worse than an honest gap.

---

## The short answer

| | Year 1 | Every year after |
|---|---|---|
| **Minimum to launch and run the app** | **~$436** | **~$411** |
| — plus the AI build tool, if still needed | **+$100–200 once** | — |
| Realistic with all five phases built | ~$700–1,100+ | ~$700–1,000+ |

For context: the club currently pays **nothing** — it runs on WhatsApp and
Instagram. This is new spending, so it is worth being clear that roughly
**$35/month** buys the whole thing at launch.

The two items that could change that materially are **taking payments for
merch** (Phase 3) and **AI photo face-matching** (Phase 5). Both are optional,
both are years-four-and-five decisions, and both are explained below.

---

## 1. What you must buy to launch

These are unavoidable if the app is going on the App Store and Play Store.

| Item | Cost | Type | Notes |
|---|---|---|---|
| **Apple Developer Program** | **$99** | Per year | Required to publish to the App Store at all. Also required for Sign in with Apple and push notifications |
| **Google Play Console** | **$25** | One-time, forever | Required to publish to the Play Store |
| **Domain name** | **~$12** | Per year | Needed for the privacy policy, which both stores require at a public web address |
| **D-U-N-S number** | **$0** | — | Free. Required to enrol Apple as a *company* rather than as an individual — which matters, see below |

**Year 1: $136. After that: $111/year.**

### Why enrol Apple as a company, not as a person

Whoever enrols owns the app. If it is enrolled under a personal Apple ID, the
app legally belongs to that individual, not to MVMNT — and moving it later is
slow and painful. Company enrolment needs the free D-U-N-S number, which takes
**1–2 weeks** for Apple to verify, so it is worth starting early even though it
costs nothing.

---

## 2. What it costs to run

The app needs a database, file storage and a way to send notifications.

| Item | Cost | What it covers |
|---|---|---|
| **Supabase Free** | **$0/month** | Enough capacity for the club, but **the project sleeps after a week of no activity** and there are no automatic backups |
| **Supabase Pro** | **$25/month** ($300/yr) | No sleeping, daily backups, far more headroom |
| **Push notifications** | **$0** | Expo's push service is free with no message limit |
| **Maps** | **$0** | The organiser's map uses OpenStreetMap, which needs no account and no API key |
| **Privacy policy hosting** | **$0** | Can be a free page on the domain above |

### My recommendation: pay the $25/month

The free tier is genuinely capable enough for 300 members. Two things make it
the wrong choice for a live club:

1. **It sleeps.** After a week of inactivity the project pauses and the app
   stops working until someone wakes it. For a club that runs weekly this may
   never bite — but it will bite during a quiet month, most likely the week
   before a big event.
2. **No automatic backups.** If data is lost, it is lost. The club's entire
   attendance history would be gone.

$300/year to avoid explaining to 2,500 people why the app is down is the right
trade. **Start on Free while testing, switch to Pro before real members use it.**

**Running cost: $300/year** (or $0 while testing).

---

## 3. Cost of building the app itself

| Item | Cost | Type |
|---|---|---|
| Building the iOS and Android apps | **$0** | — |
| The database, the organiser console, the app | **$0** | — |
| **Claude (AI coding assistant)** | **~$100/month, for 1–2 months if needed** | **One-time, temporary** |

Everything the app runs on is free or open-source. The apps are built on a Mac
that already exists, so there is no build-service subscription (Expo's paid
build service starts around $19–99/month and is **not needed** — it is a
convenience, not a requirement).

**Claude is the one real line item here.** It is the AI tool being used to
build the app faster than one person could alone — this document itself was
produced with it. Budget **up to $200 total** (two months at $100), not a
recurring cost: it stops once the build work it is doing is done, and is not
part of what it costs to *run* the app afterwards. If the remaining work
finishes in one month, the real number is $100, not $200.

**The rest of the cost of building is time, not money**, and that is being
done in-house.

---

## 4. Launch total

| | Year 1 | Ongoing |
|---|---|---|
| Apple Developer Program | $99 | $99 |
| Google Play Console | $25 | — |
| Domain | $12 | $12 |
| Supabase Pro | $300 | $300 |
| **Subtotal — running the app** | **$436** | **$411/year** |
| Claude (build tool, temporary, capped) | +$100–200 once | — |
| **Total, if the build tool is needed** | **~$536–636** | **$411/year** |

The Claude line only applies once, during the build. It is not part of what
the app costs to operate, and does not recur next year.

That covers everything the app does today: sign-up, run listings, sign-ups and
waitlists, geofenced check-in, the organiser console, and all notifications.

---

## 5. What later phases add

The app is built in five phases. Phase 1 is complete. Phases 2–5 are planned
but not built, and each carries its own cost.

### Phase 2 — Leaderboard, points, tiers, QR friend system

**Extra cost: $0.**

All database work on infrastructure already paid for.

### Phase 3 — Merch and sponsors

**Extra cost: transaction fees + [NEEDS A QUOTE].**

This is the phase that introduces real money, and it deserves care.

**Important:** Stripe — the payment provider most apps use — **does not support
businesses based in Egypt.** The realistic options are Egyptian gateways such as
**Paymob**, **Fawry** or **Accept**.

Typical structure, to be confirmed by quote:

| | Typical range |
|---|---|
| Setup fee | $0 – $200 |
| Monthly fee | $0 – $50 |
| Per transaction | **~2.5% – 3.5% + a small fixed fee** |

On $1,000 of merch sales, expect roughly **$25–35** in fees.

**[NEEDS A QUOTE]** — contact Paymob and one competitor. Fees are negotiable at
volume, and the answer depends on whether MVMNT is a registered company.

Sponsors bring in money rather than costing it; the only build cost is time.

### Phase 4 — Routes, photo galleries

**Extra cost: $0 – $100/year**, depending on volume.

| Item | Cost |
|---|---|
| Photo storage | Included in Supabase Pro up to 100GB, then **$0.021/GB/month** |
| Route maps | $0 on OpenStreetMap. Mapbox is free to 50,000 loads/month if we ever switch |

Photos are the thing to watch. A 2,500-person event might produce 500–1,000
photos; at ~3MB each that is roughly **1.5–3GB per big event**. The 100GB
included in Pro absorbs that for a long time — years, at the club's rate. Only
if the club starts storing full-resolution video does this become a real line
item.

### Phase 5 — AI photo face-matching, health stats

**Extra cost: [NEEDS A QUOTE] — and this is the expensive one.**

**Health stats (HealthKit / Health Connect): $0.** Read from the phone, shown
to the member, never stored on our servers. No ongoing cost.

**AI face-matching — "find photos of me" — is a different matter**, on two
fronts:

*The technical cost* is usage-based, roughly **$1 per 1,000 images processed**
on services like AWS Rekognition. For a large event that is genuinely small —
perhaps **$1–5 per event**, so maybe **$50–250/year** depending on how many
events and how often members search.

*The cost nobody budgets for is legal.* Face recognition means processing
**biometric data**, which is the most heavily regulated category of personal
information there is — under both Egypt's data protection law and the GDPR.
That realistically requires:

- A formal impact assessment before launch
- Explicit, separate opt-in consent from every member whose face is processed
- A defensible answer for members who never consented but appear in a photo
- Very likely, **paid legal advice** — budget **$500–2,000** as a one-off

**My honest recommendation:** treat face-matching as a genuinely optional
feature, and decide whether the club actually wants it once the rest is live.
The technical cost is trivial; the compliance burden is not. A simple "browse
the album" gallery delivers most of the value at none of the risk.

---

## 6. Full five-phase picture

| | Year 1 | Ongoing |
|---|---|---|
| Launch essentials (Apple, Google, domain) | $136 | $111 |
| Supabase Pro | $300 | $300 |
| Phase 2 | $0 | $0 |
| Phase 3 — payment gateway | [QUOTE] + ~3% of sales | ~3% of sales |
| Phase 4 — storage | $0 | $0 – $100 |
| Phase 5 — face-matching (if built) | $500 – $2,000 legal + ~$50–250 usage | ~$50 – 250 |
| **Realistic total** | **~$700 – $1,100+** | **~$700 – $1,000+** |

Excluding Phase 5's optional face-matching, the whole thing runs at roughly
**$450–550/year**.

---

## 7. What is deliberately free, and why that is safe

Worth stating plainly, because "free" sometimes means "will cost you later":

| Choice | Why it is free | Is it risky? |
|---|---|---|
| **OpenStreetMap** for the organiser's map | Open data, no account, no key | No. Millions of production apps use it. If a heavier map is ever needed, Mapbox has a generous free tier |
| **Expo push notifications** | Free, unlimited, no message cap | No. Apple and Google do not charge for push either |
| **Building on an existing Mac** | No build service needed | No. The paid service is convenience, not capability |
| **Passwordless sign-in (emailed code)** | No SMS costs | No — and it avoids SMS, which *does* cost per message and is expensive in Egypt |

**One deliberate saving worth highlighting:** sign-in uses emailed codes rather
than SMS. SMS verification typically costs **$0.01–0.05 per message**; at 300
members signing in periodically that is a small but permanent bill, and it
would have grown with the club. Email costs nothing.

---

## 8. Assumptions

So the numbers can be checked rather than taken on trust:

- **~300 members**, weekly runs, occasional large events up to 2,500 — as briefed
- One app on both iOS and Android
- One organiser console
- Data hosted with Supabase; **the region is not yet chosen**, and because the
  club is in Egypt that choice has legal implications as well as cost ones
- Prices are vendor list prices; no discounts, non-profit rates or educational
  pricing assumed. **Apple and Google both offer fee waivers for registered
  non-profits** — worth checking whether MVMNT qualifies, as it would remove
  the $99/year entirely

## 9. Before committing

1. **Start the Apple D-U-N-S application now.** Free, but 1–2 weeks of waiting,
   and everything else is blocked behind it.
2. **Get two payment gateway quotes** before Phase 3 — not before then, as the
   answer will have changed.
3. **Check non-profit status.** If MVMNT qualifies, the Apple fee may be waived.
4. **Decide the Supabase region deliberately.** It affects both cost and legal
   obligations under Egyptian data protection law.
5. **Re-verify every price at purchase time.** These are accurate as written,
   but vendors change pricing and this document will age.
