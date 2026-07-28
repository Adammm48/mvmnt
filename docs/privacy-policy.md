# MVMNT — Privacy Policy

**Status: DRAFT — not yet published, not yet reviewed by a lawyer.**

> This is an engineer's draft. It describes exactly what the software does today,
> so that whoever finalises it starts from the truth rather than from a template.
> Two things must happen before it goes live:
>
> 1. **A qualified person reviews it.** MVMNT operates in Egypt, so Law No. 151
>    of 2020 (Personal Data Protection Law) is the governing regime, and the
>    GDPR framing inherited from the original spec may not be the right one —
>    see [ADR 0002 §8](decisions/0002-check-in-location-and-retention.md).
> 2. **The placeholders below are filled in** — they are marked `[LIKE THIS]`.
>    A policy with an unfilled contact address is worse than none, because both
>    app stores check.
>
> It must be reachable at a public URL before the app can be submitted to
> either store.

**Last updated:** [DATE ON PUBLICATION]
**Applies to:** the MVMNT mobile app (iOS and Android) and the organisers' web console.

---

## Who we are

MVMNT is a running club based in Cairo, Egypt. In this policy "we" and "MVMNT"
mean [LEGAL ENTITY NAME], the operator of the club and the app.

If you have a question about your data, or want it deleted, contact us at
**[CONTACT EMAIL]**.

---

## The short version

- We collect your **name and email**, which runs you **sign up for and attend**,
  and — **only at the moment you tap "check in"** — **where you were**.
- We do **not** track your location at any other time. Not in the background,
  not between runs, not while the app is closed.
- Other members **cannot** see your profile, your email, or your location. They
  see a **count** of how many people are coming, never a list of who.
- Your check-in coordinates are **permanently deleted after 30 days**,
  automatically.
- You can **delete your account from inside the app**, at any time, without
  asking anyone.

---

## What we collect, and why

### Your account

| What | Why | How long |
|---|---|---|
| Email address | It is how you sign in — we email you a 6-digit code. We never store a password. | Until you delete your account |
| Display name | So organisers know who has signed up, and for the leaderboard in a future release | Until you delete your account |
| Profile photo *(optional)* | Only if you choose to add one | Until you remove it or delete your account |

### Your runs

| What | Why | How long |
|---|---|---|
| Which runs you sign up for, join a waitlist for, or withdraw from | To manage places and waitlists, and to send you reminders | Kept as club attendance history — anonymised if you delete your account |
| Which runs you checked in to | It is the record that you were there | As above |

### Your location — read this bit

We ask for your location for **one purpose only**: to confirm you are actually
at the meeting point when you check in to a run.

**How it works.** When you tap "check in", the app reads your position once and
sends it to our server, which measures how far you are from that run's meeting
point. If you are close enough, you are checked in.

**What we specifically do NOT do:**

- We do **not** collect your location in the background.
- We do **not** collect it while the app is closed or in the background.
- We do **not** collect it between runs, or on days you are not running.
- We do **not** build a history of your movements.
- We do **not** share your location with other members, or with anyone else.

**How long we keep it.** The coordinates from a check-in are **automatically and
permanently deleted 30 days afterwards**. This is enforced by a scheduled job,
not by anyone remembering to do it. After 30 days, the record that you attended
remains, but *where you were* is gone.

**You can refuse.** If you decline the location permission, or it fails — no
signal, dead battery, phone in a bag — **you can still attend and still be
checked in.** Ask an organiser and they will check you in by hand. Declining
location does not lock you out of anything.

### Notifications

If you turn on notifications, we store a device token so we can send them. It is
deleted when you delete your account or sign the device out. We use it only for
run notifications: a new run, reminders, the run starting or ending, and a
waitlist place opening up.

### What we do NOT collect

We do not collect health or fitness data, contacts, photos from your library,
advertising identifiers, or your browsing activity. We do not use analytics or
advertising SDKs. We do not sell data to anyone, ever, and we do not share it
for advertising.

---

## Who can see what

**Other members can see:** how many people are signed up or checked in to a run
— a number, not a list. They **cannot** see your profile, your email, whether
*you specifically* are attending, or anything about your location.

**Organisers can see:** who has signed up and who has checked in, so they can
run the event and account for everyone. They can also check people in manually.

**Nobody else.** We do not sell, rent or trade your data.

We rely on [Supabase](https://supabase.com) to host the database and
[Expo](https://expo.dev) to deliver notifications. They process data on our
instructions to run the service.

> **[TO CONFIRM BEFORE PUBLICATION]** Which region the database is hosted in.
> If it is outside Egypt, that is a cross-border transfer under Egypt's PDPL and
> this section must say so explicitly, along with the basis for it.

---

## Your rights

You can, at any time:

- **See what we hold about you** — most of it is visible in the app; ask us for the rest.
- **Correct it** — you can edit your name in the app.
- **Delete it** — Profile → *Delete my account*. No email, no waiting on a human.
- **Withdraw consent for location** — in your phone's settings. Check-in then
  falls back to an organiser doing it for you.
- **Turn off notifications** — in your phone's settings.

### What "delete my account" actually does

We think you should know precisely, rather than being told "we delete your data":

- **Permanently deleted:** your profile, your name, your email and login, every
  location record we hold about you, and your registered devices.
- **Kept, but anonymised:** the fact that *somebody* attended past runs. Your
  name is removed and the record is no longer linked to you.

We keep that last part so historical attendance numbers for runs that already
happened stay correct. Once your account is gone, those records say nothing
about you and cannot be traced back to you.

This is immediate and cannot be undone.

---

## Children

MVMNT is intended for adults. We do not knowingly collect data from children.

> **[TO CONFIRM BEFORE PUBLICATION]** If under-18s do attend club runs, this
> section needs rewriting and guardian consent is likely required for location
> processing. It also changes the app's store age rating. See
> [ADR 0002 §9](decisions/0002-check-in-location-and-retention.md).

---

## Security

- Every request is checked on our servers. The app is never trusted to decide
  what you are allowed to see or do.
- Access rules are enforced in the database itself, so a bug in the app cannot
  expose another member's data.
- We store no passwords — sign-in is a one-time emailed code.
- Sign-in tokens are held in your device's secure keychain.

No system is perfectly secure, but we designed for the case where something
goes wrong: because there is no member directory and location expires after 30
days, a breach would expose far less than it otherwise could.

---

## Changes

If we change this policy in a way that materially affects you, we will tell you
in the app before it takes effect.

---

## Contact

**[CONTACT EMAIL]** — questions, data requests, or complaints.

> **[TO CONFIRM BEFORE PUBLICATION]** Whether MVMNT must register with, or can
> be complained about to, Egypt's Data Protection Centre, and whether a named
> data protection officer is required at this scale.
