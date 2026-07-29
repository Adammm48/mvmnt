MVMNT — Engineering Principles

Version: 1.1

Purpose

This document defines the engineering standards for MVMNT. Every contributor—human or AI—should follow these principles throughout development. Whenever there is a trade-off, these principles take precedence over convenience.

1. Build for Simplicity

Choose the simplest solution that satisfies today's requirements while allowing reasonable future growth.

Avoid premature optimization.

Avoid unnecessary abstractions.

Prefer readable code over clever code.

Every new dependency must have a clear justification.

2. Single Source of Truth

Every piece of business logic should exist in one place.

Examples:

Loyalty point calculations

Tier progression

Notification rules

Permission checks

Check-in validation

Never duplicate business rules across:

mobile app

admin dashboard

backend

edge functions

Shared logic should live in reusable modules whenever possible.

3. Security First

Assume every client request is untrusted.

Rules:

Never trust client-side validation.

Validate every request on the server.

Use Row Level Security wherever possible.

Follow the principle of least privilege.

Never expose secrets in client code.

Protect all admin operations.

Log security-sensitive actions.

Authentication and authorization are requirements, not optional features.

4. Privacy by Default

Collect only the data necessary to provide the feature.

Every feature involving:

location

health data

photos

face recognition

must require explicit user consent.

Users should always understand:

what is collected

why it is collected

how to delete it

5. Accessibility by Default

Every screen should be usable by everyone.

Minimum expectations:

sufficient color contrast

scalable text

screen reader support

large touch targets

meaningful labels

keyboard navigation where appropriate

Accessibility is part of the definition of complete.

6. Performance Budgets

Fast software feels trustworthy.

Targets:

app launch feels immediate

common screens load quickly

scrolling remains smooth

interactions receive immediate feedback

Avoid unnecessary:

network requests

re-renders

database queries

large payloads

Measure performance before optimizing.

Load-test the burst-prone paths specifically before a large event: mass check-in/sign-up in a short window, simultaneous live-location connections, and notification fan-out to thousands of devices at once. MVMNT's normal scale is ~300 people; a single event has reached 2,500. Design for the 300 baseline, but verify the burst paths hold at the 2,500 peak rather than discovering the limit live.

7. Observability

Every important event should be measurable.

Log:

errors

failed check-ins

notification failures

payment failures

authentication failures

API failures

Track product metrics including:

weekly active users

attendance

retention

leaderboard participation

notification engagement

If a problem cannot be observed, it cannot be improved.

8. API-First Design

Every backend capability should have a clearly documented API.

Documentation should include:

purpose

inputs

outputs

permissions

error responses

Avoid hidden assumptions between frontend and backend.

9. Feature Flags

High-risk functionality should be released behind feature flags.

Examples:

live location

AI photo matching

loyalty experiments

sponsor features

beta functionality

Features should be enabled gradually rather than deployed to everyone at once.

10. Coding Standards

Code should optimize for maintainability.

Guidelines:

descriptive names

small focused functions

consistent formatting

minimal nesting

meaningful comments explaining why, not what

avoid duplicated code

Every file should have a clear responsibility.

11. Testing Philosophy

Critical user journeys must be tested before release.

Priority flows include:

account creation

sign in

joining a run

check-in

QR friend system

notifications

purchases

admin operations

Fix root causes instead of patching symptoms.

For a solo build, apply this with real prioritization rather than uniformly: security- and money-sensitive flows (sign-up, check-in, the QR friend system, payments) need the full rigor below before being called done. Routine admin CRUD screens don't need the same bar to ship a first working version — depth should track risk, not apply evenly everywhere.

12. Documentation

Good documentation reduces future development time.

Major architectural decisions should explain:

why the decision was made

alternatives considered

trade-offs

situations that would justify revisiting the decision

Future contributors should understand the reasoning without asking the original author.

13. AI Collaboration

AI is an engineering assistant, not an authority.

When using AI:

verify generated code

require explanations for architectural decisions

avoid blind copy-paste

keep prompts and outputs under version control when useful

prefer iterative changes over large rewrites

The repository—not the AI conversation—is the source of truth.

14. Definition of Done

A feature is complete only when all of the following are true:

Functional requirements implemented

Edge cases handled

Security reviewed

Permissions enforced

Error handling complete

Loading and empty states implemented

Accessibility checked

Performance acceptable

Tests updated

Documentation updated

Code reviewed

Ready for production deployment

In a solo context, "code reviewed" means the person building this actually read and understood what the AI agent produced before calling it done — not a step that gets silently skipped for lack of a second engineer. For the security- and money-sensitive flows named in Section 11, apply this checklist in full. For lower-risk screens, a lighter pass is acceptable to keep a solo build moving — but never skip the review step itself.

Final Principle

Optimize for long-term maintainability over short-term speed.

Every engineering decision should make the project easier to understand, easier to extend, and safer to operate six months from now than it is today.
