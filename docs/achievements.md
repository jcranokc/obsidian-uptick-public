---
title: Achievements
type: reference
status: proposed
created: 2026-08-22
updated: 2026-08-22
tags:
  - life-os
  - gamification
cssclasses:
  - life-os
  - max
---

# Achievements

```life-os
view: achievements
```

The catalog for the XP layer described in [[4 System/Game/Gamification Design]].
Definitions live here; unlock state is written back into this note by
`xp-sync.py` as an `Unlocked` column once the engine exists.

Tiers are **Bronze** (a first step, usually unlocked in week one), **Silver**
(a habit, weeks to months), **Gold** (a genuine achievement, months),
**Platinum** (a year-scale arc), **Mythic** (a handful, possibly never), and
**Hidden** (not shown until unlocked).

A deliberate design note: several of these reward *honesty* rather than
performance — grading a flashcard Again, re-rating a task harder, cancelling
work you are never going to do. A gamified system that only ever pays for
looking productive teaches you to look productive.


**258 achievements across 20 categories.**

## Contents

- [[#Volume — tasks completed|Volume — tasks completed]] — 15
- [[#Difficulty — the hard stuff|Difficulty — the hard stuff]] — 12
- [[#Speed and timing|Speed and timing]] — 14
- [[#Streaks and consistency|Streaks and consistency]] — 16
- [[#Recovery and resilience|Recovery and resilience]] — 12
- [[#Study — flashcards|Study — flashcards]] — 18
- [[#Study — quizzes and exams|Study — quizzes and exams]] — 14
- [[#Study — certifications and tracks|Study — certifications and tracks]] — 12
- [[#Meetings and Granola|Meetings and Granola]] — 14
- [[#Daily rituals|Daily rituals]] — 14
- [[#Reviews|Reviews]] — 10
- [[#Projects and bosses|Projects and bosses]] — 12
- [[#Salesforce craft|Salesforce craft]] — 16
- [[#Vault and knowledge|Vault and knowledge]] — 14
- [[#Time of day and calendar|Time of day and calendar]] — 14
- [[#Triage and inbox hygiene|Triage and inbox hygiene]] — 10
- [[#People and collaboration|People and collaboration]] — 10
- [[#Meta and self-aware|Meta and self-aware]] — 12
- [[#Hidden|Hidden]] — 10
- [[#Exam readiness|Exam readiness]] — 9

## Volume — tasks completed

The spine of the system. Every other category is flavour on top of this one.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 1 | **First Blood** | Bronze | Complete your first task | ░░░░░░ 0% | — |
| 2 | **Getting Started** | Bronze | Complete 10 tasks | ░░░░░░ 0% | — |
| 3 | **Warmed Up** | Bronze | Complete 50 tasks | ░░░░░░ 0% | — |
| 4 | **Centurion** | Silver | Complete 100 tasks | ░░░░░░ 0% | — |
| 5 | **Quarter Thousand** | Silver | Complete 250 tasks | ░░░░░░ 0% | — |
| 6 | **Five Hundred** | Gold | Complete 500 tasks | ░░░░░░ 0% | — |
| 7 | **Kilotask** | Gold | Complete 1,000 tasks | ░░░░░░ 0% | — |
| 8 | **Two Thousand Strong** | Platinum | Complete 2,500 tasks | ░░░░░░ 0% | — |
| 9 | **Five Digits Away** | Platinum | Complete 5,000 tasks | ░░░░░░ 0% | — |
| 10 | **Ten Thousand Hours** | Mythic | Complete 10,000 tasks | ░░░░░░ 0% | — |
| 11 | **Busy Signal** | Bronze | Complete 5 tasks in one day | ░░░░░░ 0% | — |
| 12 | **Double Digits** | Silver | Complete 10 tasks in one day | ░░░░░░ 0% | — |
| 13 | **Machine Mode** | Gold | Complete 20 tasks in one day | ░░░░░░ 0% | — |
| 14 | **Big Week** | Silver | Complete 40 tasks in one calendar week | ░░░░░░ 0% | — |
| 15 | **Big Month** | Gold | Complete 150 tasks in one calendar month | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Difficulty — the hard stuff

Volume is easy to fake by splitting tasks. These are not.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 16 | **Punching Up** | Bronze | Complete your first D4 (Hard) task | ░░░░░░ 0% | — |
| 17 | **Epic Slayer** | Silver | Complete your first D5 (Epic) task | ░░░░░░ 0% | — |
| 18 | **Heavy Lifter** | Silver | Complete 25 D4-or-higher tasks | ░░░░░░ 0% | — |
| 19 | **Load Bearing** | Gold | Complete 100 D4-or-higher tasks | ░░░░░░ 0% | — |
| 20 | **Ten Epics** | Gold | Complete 10 D5 tasks | ░░░░░░ 0% | — |
| 21 | **Fifty Epics** | Platinum | Complete 50 D5 tasks | ░░░░░░ 0% | — |
| 22 | **Escalation** | Silver | Complete a D1, D2, D3, D4 and D5 task in the same day | ░░░░░░ 0% | — |
| 23 | **No Small Days** | Gold | Complete only D3-or-higher tasks for a full week | — | manual |
| 24 | **Straight to the Boss** | Silver | Make a D5 task the first thing you finish that day | — | manual |
| 25 | **Sisyphus Rested** | Gold | Complete a D5 task that had been open more than 30 days | — | manual |
| 26 | **Overqualified** | Bronze | Complete 10 D1 tasks in a single day | — | manual |
| 27 | **Weight Class** | Platinum | Earn 10,000 lifetime XP from D5 tasks alone | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Speed and timing

When you did it, not how much.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 28 | **Ahead of the Curve** | Bronze | Complete a task before its due date | ░░░░░░ 0% | — |
| 29 | **Early Bird** | Silver | Complete 25 tasks early | ░░░░░░ 0% | — |
| 30 | **Precognition** | Gold | Complete 100 tasks early | ░░░░░░ 0% | — |
| 31 | **Same Day Service** | Bronze | Complete a task on the day it was created | ░░░░░░ 0% | — |
| 32 | **Inbox Interceptor** | Silver | Complete 25 tasks on their creation day | ░░░░░░ 0% | — |
| 33 | **Clean Sweep** | Silver | Finish every task due today, today | ░░░░░░ 0% | — |
| 34 | **Perfect Week** | Gold | Finish every task due that week, on time, for a full week | ░░░░░░ 0% | — |
| 35 | **Perfect Month** | Platinum | A full calendar month with zero tasks going overdue | ░░░░░░ 0% | — |
| 36 | **Deadline Dancer** | Bronze | Complete a task within an hour of its due date | — | manual |
| 37 | **Buzzer Beater** | Silver | Complete a D4+ task on its due date after 8pm | — | manual |
| 38 | **Nothing Overdue** | Silver | Reach a state of zero overdue tasks | ░░░░░░ 0% | — |
| 39 | **Nothing Overdue II** | Gold | Hold zero overdue tasks for 14 consecutive days | ░░░░░░ 0% | — |
| 40 | **Nothing Overdue III** | Platinum | Hold zero overdue tasks for 60 consecutive days | ░░░░░░ 0% | — |
| 41 | **Fast Follow** | Bronze | Complete a task created from a meeting within 24 hours of that meeting | — | manual |
|---|---|---|---|---|---|
## Streaks and consistency

Rewarded, but never punished — see the streak-freeze rule.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 42 | **Day Two** | Bronze | A 2-day streak | ██████ | ✅ 2026-08-23 |
| 43 | **Working Week** | Bronze | A 7-day streak | ██░░░░ 29% | — |
| 44 | **Fortnight** | Silver | A 14-day streak | █░░░░░ 14% | — |
| 45 | **Full Moon** | Silver | A 30-day streak | ░░░░░░ 7% | — |
| 46 | **Quarter Note** | Gold | A 90-day streak | ░░░░░░ 2% | — |
| 47 | **Half Year** | Gold | A 180-day streak | ░░░░░░ 1% | — |
| 48 | **Annual** | Platinum | A 365-day streak | ░░░░░░ 1% | — |
| 49 | **Unbroken** | Mythic | A 730-day streak | ░░░░░░ 0% | — |
| 50 | **Maxed Multiplier** | Silver | Reach the +30% streak bonus cap | █░░░░░ 13% | — |
| 51 | **Weekend Warrior** | Bronze | Earn XP on a Saturday and a Sunday in the same weekend | ░░░░░░ 0% | — |
| 52 | **Four Weekends** | Silver | Earn XP on four consecutive weekends | ░░░░░░ 0% | — |
| 53 | **Freeze Frame** | Bronze | Have a streak freeze spent on your behalf | ░░░░░░ 0% | — |
| 54 | **Didn't Need It** | Silver | Go a full month without spending a streak freeze | — | manual |
| 55 | **Back on the Horse** | Bronze | Start a new streak the day after breaking one | — | manual |
| 56 | **Longer This Time** | Silver | Beat your previous longest streak | ░░░░░░ 0% | — |
| 57 | **Comeback Season** | Gold | Return to a 30-day streak after a break of 7+ days | — | manual |
|---|---|---|---|---|---|
## Recovery and resilience

The category that exists so a bad stretch has a way out that isn't shame.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 58 | **Debt Collector** | Bronze | Clear an overdue task | ░░░░░░ 0% | — |
| 59 | **Dig Out** | Silver | Clear 5 overdue tasks in one day | ░░░░░░ 0% | — |
| 60 | **Excavation** | Gold | Clear 15 overdue tasks in one day | ░░░░░░ 0% | — |
| 61 | **Zero Balance** | Silver | Go from 10+ overdue tasks to zero | — | manual |
| 62 | **Necromancer** | Silver | Complete a task that had been overdue more than 30 days | ░░░░░░ 0% | — |
| 63 | **Archaeologist** | Gold | Complete a task that had been overdue more than 90 days | ░░░░░░ 0% | — |
| 64 | **Unblocked** | Bronze | Move a task out of Blocked and complete it the same day | ░░░░░░ 0% | — |
| 65 | **Unblocker** | Silver | Unblock and complete 10 tasks | ░░░░░░ 0% | — |
| 66 | **Cut the Rope** | Silver | Close out a task blocked for more than 21 days | — | manual |
| 67 | **Net Positive** | Silver | End a week with more XP earned than lost, after a week where you didn't | — | manual |
| 68 | **Damage Control** | Gold | Recover a full level's worth of XP after decay dropped you below the threshold | — | manual |
| 69 | **Still Here** | Gold | Earn XP in a month following a month with fewer than 5 active days | — | manual |
|---|---|---|---|---|---|
## Study — flashcards

Reads LearnKit's `review` and `note-review` analytics events.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 70 | **First Card** | Bronze | Review your first flashcard | ░░░░░░ 0% | — |
| 71 | **Hundred Cards** | Bronze | Review 100 cards | ░░░░░░ 0% | — |
| 72 | **Five Hundred Cards** | Silver | Review 500 cards | ░░░░░░ 0% | — |
| 73 | **Thousand Cards** | Silver | Review 1,000 cards | ░░░░░░ 0% | — |
| 74 | **Five Thousand Cards** | Gold | Review 5,000 cards | ░░░░░░ 0% | — |
| 75 | **Twenty Thousand Cards** | Platinum | Review 20,000 cards | ░░░░░░ 0% | — |
| 76 | **Daily Driver** | Bronze | Clear your scheduled reviews for the day | ░░░░░░ 0% | — |
| 77 | **Seven Clean Days** | Silver | Clear scheduled reviews 7 days running | ░░░░░░ 0% | — |
| 78 | **Thirty Clean Days** | Gold | Clear scheduled reviews 30 days running | ░░░░░░ 0% | — |
| 79 | **Deck Cleared** | Bronze | Take a deck to zero due cards | ░░░░░░ 0% | — |
| 80 | **Deck Master** | Silver | Hold a 90%+ retention rate on a deck of 100+ cards | — | manual |
| 81 | **Honest Work** | Bronze | Grade a card Again — the system pays you for it | ░░░░░░ 0% | — |
| 82 | **Hard Mode** | Silver | Review 100 cards graded Hard without abandoning the session | — | manual |
| 83 | **Mature Collection** | Gold | Have 500 cards reach a review interval over 30 days | ░░░░░░ 0% | — |
| 84 | **Card Author** | Bronze | Create your first flashcard | ██████ | ✅ 2026-08-23 |
| 85 | **Deck Builder** | Silver | Create a deck of 100+ cards | ██████ | ✅ 2026-08-23 |
| 86 | **Curriculum** | Gold | Create 500 cards across 5+ decks | ████░░ 60% | — |
| 87 | **Leech Hunter** | Silver | Rewrite a card that failed 8+ times, then get it right 3 times running | — | manual |
|---|---|---|---|---|---|
## Study — quizzes and exams

Reads LearnKit `exam-attempt` events, banded by question count.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 88 | **Pop Quiz** | Bronze | Complete your first quiz | ░░░░░░ 0% | — |
| 89 | **Test Taker** | Bronze | Complete your first 15+ question test | ░░░░░░ 0% | — |
| 90 | **Full Length** | Silver | Complete your first 40+ question practice exam | ░░░░░░ 0% | — |
| 91 | **Passing Grade** | Bronze | Score 65%+ on any exam | ░░░░░░ 0% | — |
| 92 | **Comfortable Pass** | Silver | Score 80%+ on a practice exam | ░░░░░░ 0% | — |
| 93 | **Exam Ready** | Gold | Score 90%+ on a 40+ question practice exam | ░░░░░░ 0% | — |
| 94 | **Perfect Paper** | Gold | Score 100% on a 15+ question test | ░░░░░░ 0% | — |
| 95 | **Ten Exams** | Silver | Complete 10 practice exams | ░░░░░░ 0% | — |
| 96 | **Fifty Exams** | Gold | Complete 50 practice exams | ░░░░░░ 0% | — |
| 97 | **Trending Up** | Silver | Beat your previous score on the same exam three times running | ░░░░░░ 0% | — |
| 98 | **From 50 to 90** | Gold | Take one exam from below 60% to above 90% | — | manual |
| 99 | **No Timer Needed** | Silver | Finish a practice exam in under half the allotted time and still pass | — | manual |
| 100 | **Read the Question** | Bronze | Complete an exam with zero auto-submitted answers | — | manual |
| 101 | **Marathon** | Silver | Complete a 60+ question exam in one sitting | — | manual |
|---|---|---|---|---|---|
## Study — certifications and tracks

The reason the study half exists. Certification pass is entered by hand.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 102 | **Enrolled** | Bronze | Create a study plan with an exam date | ██████ | ✅ 2026-08-22 |
| 103 | **On Track** | Silver | Hit your daily study target 7 days running | — | manual |
| 104 | **Ahead of Schedule** | Gold | Hit your study plan targets for 30 days running | — | manual |
| 105 | **Certified** | Gold | Pass a certification (+2,500 XP) | ░░░░░░ 0% | — |
| 106 | **Double Certified** | Gold | Hold 2 active certifications | ░░░░░░ 0% | — |
| 107 | **Triple Threat** | Platinum | Hold 3 active certifications | ░░░░░░ 0% | — |
| 108 | **Five Badges** | Platinum | Hold 5 active certifications | ░░░░░░ 0% | — |
| 109 | **Architect Track** | Mythic | Pass a Salesforce Architect-level certification | — | manual |
| 110 | **Maintained** | Silver | Complete a certification maintenance module | — | manual |
| 111 | **No Lapses** | Gold | Keep every certification current for a full year | — | manual |
| 112 | **First Try** | Gold | Pass a certification on the first attempt | ░░░░░░ 0% | — |
| 113 | **Second Time's the Charm** | Silver | Pass a certification after a failed attempt | — | manual |
|---|---|---|---|---|---|
## Meetings and Granola

The intake side of the pipeline.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 114 | **Recorded** | Bronze | Import your first Granola meeting note | ░░░░░░ 0% | — |
| 115 | **Fifty Meetings** | Silver | Import 50 meeting notes | ░░░░░░ 0% | — |
| 116 | **Two Hundred Meetings** | Gold | Import 200 meeting notes | ░░░░░░ 0% | — |
| 117 | **Prepared** | Bronze | Have an agenda on a meeting note before the meeting starts | ░░░░░░ 0% | — |
| 118 | **Always Prepared** | Silver | Agenda-before-start on 25 meetings | ░░░░░░ 0% | — |
| 119 | **Action Extractor** | Bronze | Have 5 tasks created from a single meeting | ░░░░░░ 0% | — |
| 120 | **Ten Out of One** | Silver | Have 10 tasks created from a single meeting | ░░░░░░ 0% | — |
| 121 | **Meeting to Done** | Bronze | Complete every task from a single meeting | ░░░░░░ 0% | — |
| 122 | **Clean Slate** | Silver | Complete every task from 10 consecutive meetings | ░░░░░░ 0% | — |
| 123 | **Standup Regular** | Silver | Attend 30 standups in a recurring series | — | manual |
| 124 | **Note Taker** | Silver | Add discussion notes to 50 meeting records | — | manual |
| 125 | **Follow Through** | Gold | Complete every task from every meeting in a full week | — | manual |
| 126 | **Quiet Week** | Bronze | A week with fewer than 5 meetings | — | manual |
| 127 | **Meeting Marathon** | Bronze | 6 or more meetings in one day | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Daily rituals

Small XP, but a lot of achievements — these are the habits worth naming.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 128 | **Intentional** | Bronze | Fill in What Matters Today for the first time | ░░░░░░ 0% | — |
| 129 | **Morning Person** | Bronze | Fill it in before 8:00 | ░░░░░░ 0% | — |
| 130 | **Seven Intentions** | Bronze | Fill it in 7 days running | ░░░░░░ 0% | — |
| 131 | **Thirty Intentions** | Silver | Fill it in 30 days running | ░░░░░░ 0% | — |
| 132 | **Hundred Intentions** | Gold | Fill it in 100 days running | ░░░░░░ 0% | — |
| 133 | **Logged** | Bronze | Write your first work log entry | ░░░░░░ 0% | — |
| 134 | **Hundred Entries** | Silver | Write 100 work log entries | ░░░░░░ 0% | — |
| 135 | **Thousand Entries** | Gold | Write 1,000 work log entries | ░░░░░░ 0% | — |
| 136 | **Full Log** | Bronze | Four work log entries in one day | ░░░░░░ 0% | — |
| 137 | **Closed Loop** | Bronze | Complete an End of Day review | ░░░░░░ 0% | — |
| 138 | **Thirty Closes** | Silver | Complete End of Day 30 times | ░░░░░░ 0% | — |
| 139 | **Hundred Closes** | Gold | Complete End of Day 100 times | ░░░░░░ 0% | — |
| 140 | **Full House** | Silver | In one day: intentions, four log entries, and End of Day | ░░░░░░ 0% | — |
| 141 | **Perfect Ritual Week** | Gold | Full House five working days running | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Reviews

Weekly and monthly. The part everybody skips.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 142 | **Reviewer** | Bronze | Complete your first weekly review | ░░░░░░ 0% | — |
| 143 | **Four Weeks** | Silver | Complete 4 weekly reviews running | ░░░░░░ 0% | — |
| 144 | **Twelve Weeks** | Gold | Complete 12 weekly reviews running | ░░░░░░ 0% | — |
| 145 | **Fifty Two** | Platinum | Complete 52 weekly reviews | ░░░░░░ 0% | — |
| 146 | **Monthly Check** | Bronze | Complete your first monthly review | ░░░░░░ 0% | — |
| 147 | **Quarter Reviewed** | Silver | Complete 3 monthly reviews running | ░░░░░░ 0% | — |
| 148 | **Year Reviewed** | Gold | Complete 12 monthly reviews | ░░░░░░ 0% | — |
| 149 | **Carry Forward** | Bronze | Move a stalled task forward in a weekly review | — | manual |
| 150 | **Honest Accounting** | Silver | Record a blocker in a weekly review, then clear it the next week | — | manual |
| 151 | **Nothing Stalled** | Gold | A weekly review with zero stalled items | — | manual |
|---|---|---|---|---|---|
## Projects and bosses

Depends on the boss-fight mechanic in section 6 of the design.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 152 | **First Boss** | Bronze | Complete every task in a project | ░░░░░░ 0% | — |
| 153 | **Boss Rush** | Silver | Complete 5 projects | ░░░░░░ 0% | — |
| 154 | **Campaign** | Gold | Complete 20 projects | ░░░░░░ 0% | — |
| 155 | **Overkill** | Bronze | Deal more than 500 damage to one boss in a single day | — | manual |
| 156 | **Final Blow** | Bronze | Land the last task of a project | ░░░░░░ 0% | — |
| 157 | **Solo Run** | Silver | Complete a project of 15+ tasks | ░░░░░░ 0% | — |
| 158 | **Raid Boss** | Gold | Complete a project of 40+ tasks | ░░░░░░ 0% | — |
| 159 | **No Retreat** | Gold | Complete a project with zero tasks going overdue | — | manual |
| 160 | **Long Campaign** | Silver | Complete a project that ran more than 90 days | — | manual |
| 161 | **Two Fronts** | Silver | Advance three different projects in the same day | — | manual |
| 162 | **Cleared the Board** | Gold | Have zero active projects with overdue tasks | — | manual |
| 163 | **Scope Cut** | Bronze | Close a project by deliberately cancelling its remaining tasks | — | manual |
|---|---|---|---|---|---|
## Salesforce craft

Specific to the actual job. These are the ones that will feel earned.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 164 | **Deployed** | Bronze | Complete your first deployment task | ░░░░░░ 0% | — |
| 165 | **Ten Deploys** | Silver | Complete 10 deployment tasks | ░░░░░░ 0% | — |
| 166 | **Fifty Deploys** | Gold | Complete 50 deployment tasks | ░░░░░░ 0% | — |
| 167 | **Sandbox Refreshed** | Silver | Complete a sandbox refresh task | ░░░░░░ 0% | — |
| 168 | **Full Refresh Cycle** | Gold | Complete a refresh across every sandbox in one cycle | — | manual |
| 169 | **Permission Surgeon** | Silver | Complete 10 permission-set tasks | ░░░░░░ 0% | — |
| 170 | **Least Privilege** | Gold | Complete a permission-model review end to end | — | manual |
| 171 | **Integration Wrangler** | Silver | Complete 10 integration tasks | ░░░░░░ 0% | — |
| 172 | **Data Mover** | Silver | Complete 10 data load or remediation tasks | ░░░░░░ 0% | — |
| 173 | **Bug Squasher** | Bronze | Complete 10 tasks tagged as bugs | ░░░░░░ 0% | — |
| 174 | **Exterminator** | Gold | Complete 100 bug tasks | ░░░░░░ 0% | — |
| 175 | **Sprint Closer** | Silver | Complete every REQ ticket in a sprint | — | manual |
| 176 | **Ticket to Ride** | Silver | Complete 50 tasks carrying a REQ number | ░░░░░░ 0% | — |
| 177 | **Production Careful** | Gold | Complete 25 production-touching tasks with none reopened | — | manual |
| 178 | **Release Manager** | Gold | Complete a full release cycle: build, test, deploy, verify | — | manual |
| 179 | **Org Whisperer** | Platinum | Complete 500 Salesforce-tagged tasks | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Vault and knowledge

The second brain rewarding itself for being maintained.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 180 | **First Note** | Bronze | Create your first knowledge note | ██████ | ✅ 2026-08-22 |
| 181 | **Hundred Notes** | Silver | Reach 100 notes in the vault | ██░░░░ 28% | — |
| 182 | **Five Hundred Notes** | Silver | Reach 500 notes | ░░░░░░ 6% | — |
| 183 | **Thousand Notes** | Gold | Reach 1,000 notes | ░░░░░░ 3% | — |
| 184 | **Connected** | Bronze | Add 10 wikilinks in a day | — | manual |
| 185 | **Web Weaver** | Silver | Have a note with 20+ inbound links | — | manual |
| 186 | **Decided** | Bronze | Record your first decision note | — | manual |
| 187 | **Ten Decisions** | Silver | Record 10 decision notes | — | manual |
| 188 | **Inbox Zero** | Bronze | Empty the capture inbox | — | manual |
| 189 | **Inbox Zero Streak** | Silver | Empty the capture inbox 7 days running | — | manual |
| 190 | **Gardener** | Silver | Update 20 existing notes in a week without creating a new one | — | manual |
| 191 | **No Orphans** | Gold | Zero notes with no inbound or outbound links | — | manual |
| 192 | **Templated** | Bronze | Create a new note template | — | manual |
| 193 | **Automated** | Silver | Add a new scheduled automation job to the vault | — | manual |
|---|---|---|---|---|---|
## Time of day and calendar

Odd hours and odd dates. Pure flavour, cheap to implement.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 194 | **Dawn Patrol** | Bronze | Complete a task before 6:00 | ░░░░░░ 0% | — |
| 195 | **Before the Coffee** | Silver | Complete 25 tasks before 8:00 | ░░░░░░ 0% | — |
| 196 | **Night Owl** | Bronze | Complete a task after 23:00 | ░░░░░░ 0% | — |
| 197 | **Burning the Midnight Oil** | Silver | Complete 25 tasks after 23:00 | ░░░░░░ 0% | — |
| 198 | **Lunch Break** | Bronze | Complete a task between 12:00 and 13:00 | — | manual |
| 199 | **Bookends** | Bronze | Complete a task before 8:00 and after 20:00 on the same day | ░░░░░░ 0% | — |
| 200 | **Weekend Shift** | Bronze | Complete 5 tasks on a Saturday | ░░░░░░ 0% | — |
| 201 | **Monday Momentum** | Silver | Complete 10 tasks on a Monday | ░░░░░░ 0% | — |
| 202 | **Friday Finisher** | Silver | End 10 consecutive Fridays with zero overdue tasks | — | manual |
| 203 | **Leap Day** | Bronze | Earn XP on 29 February | — | manual |
| 204 | **New Year, New Task** | Bronze | Complete a task on 1 January | — | manual |
| 205 | **Birthday Work** | Bronze | Earn XP on your birthday | — | manual |
| 206 | **Holiday Hours** | Bronze | Complete a task on a public holiday | — | manual |
| 207 | **Quarter Close** | Silver | Complete 20 tasks in the last week of a quarter | — | manual |
|---|---|---|---|---|---|
## Triage and inbox hygiene

Rewards keeping the pipeline honest, not just draining it.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 208 | **Triaged** | Bronze | Give a task a difficulty by hand | ░░░░░░ 0% | — |
| 209 | **Calibrator** | Silver | Hand-set difficulty on 25 tasks | ░░░░░░ 0% | — |
| 210 | **Trust the Rules** | Silver | Go 30 days without overriding a computed difficulty | — | manual |
| 211 | **Sorted** | Bronze | Take the Task Inbox to fully triaged | ░░░░░░ 0% | — |
| 212 | **Sorted Streak** | Silver | Fully triaged 7 days running | ░░░░░░ 0% | — |
| 213 | **Pruner** | Bronze | Cancel a task you are never going to do | — | manual |
| 214 | **Ruthless** | Silver | Cancel 25 tasks in one triage pass | — | manual |
| 215 | **Right-Sized** | Silver | Split a D5 task into three smaller tasks | — | manual |
| 216 | **Dated** | Bronze | Give a due date to 20 undated tasks | — | manual |
| 217 | **Provenance** | Silver | Have 100 consecutive tasks arrive with a source link intact | — | manual |
|---|---|---|---|---|---|
## People and collaboration

Tasks involving other people, drawn from the People links already on task lines.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 218 | **Handed Off** | Bronze | Complete a task that unblocks someone else | — | manual |
| 219 | **Good Teammate** | Silver | Complete 25 tasks naming another person | — | manual |
| 220 | **Fast Reply** | Bronze | Complete an email-derived task within 4 hours | — | manual |
| 221 | **Nobody Waiting** | Silver | Zero open tasks that name another person as blocked | — | manual |
| 222 | **Follow Up** | Bronze | Complete a task that was itself a follow-up | — | manual |
| 223 | **Chased It Down** | Silver | Complete a follow-up task that had been reopened twice | — | manual |
| 224 | **Sign Off** | Silver | Get sign-off on a document you sent for review | — | manual |
| 225 | **Onboarder** | Silver | Complete 10 access or provisioning tasks for other people | — | manual |
| 226 | **Escalated Well** | Silver | Move a task to Blocked with a named owner and clear it within a week | — | manual |
| 227 | **Room of One's Own** | Bronze | A full day with zero meetings and 5+ tasks completed | — | manual |
|---|---|---|---|---|---|
## Meta and self-aware

The ones that name your patterns instead of pretending they don't exist.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 228 | **Tomorrow's Problem** | Bronze | Reschedule the same task three times | ░░░░░░ 0% | — |
| 229 | **Tomorrow's Problem II** | Silver | Reschedule the same task ten times — and then do it | ░░░░░░ 0% | — |
| 230 | **Optimist** | Bronze | Set 10 tasks due on the same day | — | manual |
| 231 | **Realist** | Silver | Complete every task on a day where you set 10 | — | manual |
| 232 | **Yak Shaver** | Bronze | Create a task while completing another task | — | manual |
| 233 | **Scope Creep** | Bronze | Watch a D2 task get re-rated to D4 | — | manual |
| 234 | **Honest Difficulty** | Silver | Re-rate a task harder rather than easier | — | manual |
| 235 | **Read the Manual** | Bronze | Open the Gamification Design note | — | manual |
| 236 | **Achievement Hunter** | Silver | Unlock 50 achievements | █░░░░░ 10% | — |
| 237 | **Completionist** | Gold | Unlock 150 achievements | ░░░░░░ 3% | — |
| 238 | **Full Dex** | Mythic | Unlock every non-hidden achievement | — | manual |
| 239 | **Touch Grass** | Bronze | Take a full week of vacation mode | ░░░░░░ 0% | — |
|---|---|---|---|---|---|
## Hidden

Not listed in the UI until unlocked. Keep the conditions to yourself.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 240 | **Ghost in the Machine** | Hidden | Complete a task the automation created and you never read | — | manual |
| 241 | **Exactly 42** | Hidden | End a day on exactly 42 XP | — | manual |
| 242 | **Nice** | Hidden | End a day on exactly 69 XP | — | manual |
| 243 | **Round Numbers** | Hidden | Cross a level threshold on exactly the required XP | — | manual |
| 244 | **Zero Day** | Hidden | Earn zero XP and lose zero XP on an active day | — | manual |
| 245 | **Palindrome** | Hidden | Finish a task on a palindromic date | — | manual |
| 246 | **Speedrun** | Hidden | Gain a full level in a single day | — | manual |
| 247 | **Any%** | Hidden | Gain two full levels in a single day | — | manual |
| 248 | **The Long Game** | Hidden | Complete a task created more than a year earlier | — | manual |
| 249 | **Phoenix** | Hidden | Return to a 30-day streak after a break of 90+ days | — | manual |
|---|---|---|---|---|---|
## Exam readiness

Depends on [[4 System/Game/Exam Readiness Model]]. These reward calibration and
honest evidence rather than raw study volume.

| # | Achievement | Tier | Condition | Progress | Unlocked |
|---|---|---|---|---|---|
| 250 | **Calibrated** | Silver | Sit an exam the model predicted within 5 points of your actual score | — | manual |
| 251 | **Green Light** | Silver | Reach 90 readiness on any certification | ░░░░░░ 0% | — |
| 252 | **No Weak Domain** | Silver | Every blueprint domain above 50% mastery at once | ░░░░░░ 0% | — |
| 253 | **Full Blueprint** | Gold | 100% coverage across every domain of a certification | ░░░░░░ 0% | — |
| 254 | **Trusted the Model** | Gold | Book the exam within 7 days of hitting 90 readiness, and pass | — | manual |
| 255 | **Stability** | Silver | Three consecutive practice exams within 4 points of each other, all above pass+5 | — | manual |
| 256 | **No Retakes** | Gold | Reach 90 readiness without re-sitting a single question bank | ░░░░░░ 0% | — |
| 257 | **Sat It Anyway** | Silver | Sit an exam below 80 readiness — and pass | — | manual |
| 258 | **Back In** | Silver | Return to a certification after 30+ days away and recover your readiness | — | manual |
|---|---|---|---|---|---|
## Notes on tuning

- **Bronze should be unavoidable.** If you finish week one without a dozen of
  them, the thresholds are set too high.
- **Nothing here rewards opening the app.** Every condition requires work,
  study, or an honest piece of maintenance. The failure mode of most badge
  systems is paying for presence.
- **Hidden achievements carry no XP bonus** — they exist to be found, and
  attaching a reward to them just makes people go looking for the list.
- **Achievements pay a flat XP bonus by tier**: Bronze 50, Silver 150,
  Gold 500, Platinum 1,500, Mythic 5,000, Hidden 0. Unlocking all of Bronze is
  worth roughly one day of work — they are punctuation, not income.
