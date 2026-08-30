#!/usr/bin/env python3
"""The achievement catalog, as data the XP engine can evaluate.

Each entry is (slug, name, tier, category, predicate). The predicate takes a
Stats snapshot and returns True when the achievement is earned. Achievements
that no available data can decide carry `MANUAL` instead of a predicate; those
are unlocked by hand by ticking them in 4 System/Game/Achievements.md.

Prose definitions live in 4 System/Game/Achievements.md. This file is the
machine-readable half; the two are kept in step by `xp-sync.py --audit`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

TIER_XP = {"Bronze": 50, "Silver": 150, "Gold": 500,
           "Platinum": 1500, "Mythic": 5000, "Hidden": 0}

MANUAL = None


@dataclass
class Stats:
    """Everything the predicates are allowed to look at."""
    # volume
    tasks_done: int = 0
    tasks_done_today: int = 0
    max_tasks_day: int = 0
    max_tasks_week: int = 0
    max_tasks_month: int = 0
    by_difficulty: dict[int, int] = field(default_factory=dict)
    hard_plus_done: int = 0          # D4 or D5
    epics_done: int = 0              # D5
    xp_from_epics: int = 0
    all_difficulties_one_day: bool = False
    # timing
    done_early: int = 0
    done_same_day: int = 0
    done_late: int = 0
    zero_overdue_now: bool = False
    zero_overdue_streak: int = 0
    perfect_weeks: int = 0
    perfect_months: int = 0
    # streaks
    streak: int = 0
    longest_streak: int = 0
    streak_freezes_used: int = 0
    weekend_pairs: int = 0
    beat_longest_streak: bool = False
    # recovery
    overdue_cleared: int = 0
    max_overdue_cleared_day: int = 0
    revived_30d: int = 0             # completed a task overdue > 30 days
    revived_90d: int = 0
    unblocked_completed: int = 0
    # study — cards
    cards_reviewed: int = 0
    cards_created: int = 0
    notes_reviewed: int = 0
    decks_cleared: int = 0
    scheduled_clear_streak: int = 0
    graded_again: int = 0
    mature_cards: int = 0            # stability > 30 days
    # study — exams
    quizzes_taken: int = 0
    tests_taken: int = 0
    full_exams_taken: int = 0
    best_exam_pct: float = 0.0
    best_full_exam_pct: float = 0.0
    perfect_tests: int = 0
    exam_improve_streak: int = 0
    # study — certifications
    certs_passed: int = 0
    certs_first_try: int = 0
    real_exams_sat: int = 0
    max_readiness: float = 0.0
    no_weak_domain: bool = False
    full_blueprint_coverage: bool = False
    readiness_no_retakes: bool = False
    study_plans: int = 0
    # meetings
    meetings_imported: int = 0
    meetings_with_agenda: int = 0
    max_tasks_one_meeting: int = 0
    meetings_fully_closed: int = 0
    max_meetings_day: int = 0
    # rituals
    intention_days: int = 0
    intention_streak: int = 0
    intentions_before_8: int = 0
    worklog_entries: int = 0
    full_log_days: int = 0
    eod_completes: int = 0
    full_house_days: int = 0
    full_house_streak: int = 0
    # reviews
    weekly_reviews: int = 0
    weekly_review_streak: int = 0
    monthly_reviews: int = 0
    monthly_review_streak: int = 0
    # projects
    projects_completed: int = 0
    max_project_tasks: int = 0
    # salesforce craft
    deploy_tasks: int = 0
    sandbox_tasks: int = 0
    permission_tasks: int = 0
    integration_tasks: int = 0
    data_tasks: int = 0
    bug_tasks: int = 0
    req_tasks: int = 0
    salesforce_tasks: int = 0
    # vault
    note_count: int = 0
    # time of day
    before_6: int = 0
    before_8: int = 0
    after_23: int = 0
    saturday_tasks_max: int = 0
    monday_tasks_max: int = 0
    bookend_days: int = 0
    # triage
    manual_difficulty: int = 0
    fully_triaged_days: int = 0
    fully_triaged_streak: int = 0
    reschedule_max: int = 0
    # meta
    achievements_unlocked: int = 0
    read_the_design: bool = False
    vacation_weeks: int = 0
    # bank
    bank_lifetime: float = 0.0
    goals_completed: int = 0


def _d(s: Stats, level: int) -> int:
    return s.by_difficulty.get(level, 0)



class Spec:
    """An achievement condition that can also say how far along you are.

    Unlocked/not is enough to award a badge, but a wall of locked badges tells
    you nothing about which ones are nearly yours. Every threshold condition
    therefore reports a value and a target so the UI can draw a progress bar.
    """

    def __call__(self, stats) -> bool:
        raise NotImplementedError

    def progress(self, stats) -> tuple[float, float]:
        """(current, target). Target 1 means it is a yes/no condition."""
        raise NotImplementedError


class T(Spec):
    """Reach a threshold: `value(stats) >= target`."""

    def __init__(self, getter, target: float, unit: str = ""):
        self.getter, self.target, self.unit = getter, target, unit

    def __call__(self, stats) -> bool:
        return self._value(stats) >= self.target

    def _value(self, stats) -> float:
        try:
            return float(self.getter(stats) or 0)
        except Exception:
            return 0.0

    def progress(self, stats) -> tuple[float, float]:
        return min(self._value(stats), self.target), float(self.target)


class F(Spec):
    """A yes/no condition with no meaningful partial state."""

    def __init__(self, getter):
        self.getter = getter

    def __call__(self, stats) -> bool:
        try:
            return bool(self.getter(stats))
        except Exception:
            return False

    def progress(self, stats) -> tuple[float, float]:
        return (1.0 if self(stats) else 0.0), 1.0


# (slug, name, tier, category, predicate)
CATALOG: list[tuple[str, str, str, str, object]] = [
    # ---------------------------------------------------------- volume (15)
    ("first-blood", "First Blood", "Bronze", "Volume", T(lambda s: s.tasks_done, 1)),
    ("getting-started", "Getting Started", "Bronze", "Volume", T(lambda s: s.tasks_done, 10)),
    ("warmed-up", "Warmed Up", "Bronze", "Volume", T(lambda s: s.tasks_done, 50)),
    ("centurion", "Centurion", "Silver", "Volume", T(lambda s: s.tasks_done, 100)),
    ("quarter-thousand", "Quarter Thousand", "Silver", "Volume", T(lambda s: s.tasks_done, 250)),
    ("five-hundred", "Five Hundred", "Gold", "Volume", T(lambda s: s.tasks_done, 500)),
    ("kilotask", "Kilotask", "Gold", "Volume", T(lambda s: s.tasks_done, 1000)),
    ("two-thousand", "Two Thousand Strong", "Platinum", "Volume", T(lambda s: s.tasks_done, 2500)),
    ("five-digits-away", "Five Digits Away", "Platinum", "Volume", T(lambda s: s.tasks_done, 5000)),
    ("ten-thousand-hours", "Ten Thousand Hours", "Mythic", "Volume", T(lambda s: s.tasks_done, 10000)),
    ("busy-signal", "Busy Signal", "Bronze", "Volume", T(lambda s: s.max_tasks_day, 5)),
    ("double-digits", "Double Digits", "Silver", "Volume", T(lambda s: s.max_tasks_day, 10)),
    ("machine-mode", "Machine Mode", "Gold", "Volume", T(lambda s: s.max_tasks_day, 20)),
    ("big-week", "Big Week", "Silver", "Volume", T(lambda s: s.max_tasks_week, 40)),
    ("big-month", "Big Month", "Gold", "Volume", T(lambda s: s.max_tasks_month, 150)),

    # ------------------------------------------------------ difficulty (12)
    ("punching-up", "Punching Up", "Bronze", "Difficulty", T(lambda s: _d(s, 4), 1)),
    ("epic-slayer", "Epic Slayer", "Silver", "Difficulty", T(lambda s: _d(s, 5), 1)),
    ("heavy-lifter", "Heavy Lifter", "Silver", "Difficulty", T(lambda s: s.hard_plus_done, 25)),
    ("load-bearing", "Load Bearing", "Gold", "Difficulty", T(lambda s: s.hard_plus_done, 100)),
    ("ten-epics", "Ten Epics", "Gold", "Difficulty", T(lambda s: s.epics_done, 10)),
    ("fifty-epics", "Fifty Epics", "Platinum", "Difficulty", T(lambda s: s.epics_done, 50)),
    ("escalation", "Escalation", "Silver", "Difficulty", F(lambda s: s.all_difficulties_one_day)),
    ("no-small-days", "No Small Days", "Gold", "Difficulty", MANUAL),
    ("straight-to-boss", "Straight to the Boss", "Silver", "Difficulty", MANUAL),
    ("sisyphus-rested", "Sisyphus Rested", "Gold", "Difficulty", MANUAL),
    ("overqualified", "Overqualified", "Bronze", "Difficulty", MANUAL),
    ("weight-class", "Weight Class", "Platinum", "Difficulty", T(lambda s: s.xp_from_epics, 10000)),

    # ------------------------------------------------- speed and timing (14)
    ("ahead-of-curve", "Ahead of the Curve", "Bronze", "Timing", T(lambda s: s.done_early, 1)),
    ("early-bird", "Early Bird", "Silver", "Timing", T(lambda s: s.done_early, 25)),
    ("precognition", "Precognition", "Gold", "Timing", T(lambda s: s.done_early, 100)),
    ("same-day-service", "Same Day Service", "Bronze", "Timing", T(lambda s: s.done_same_day, 1)),
    ("inbox-interceptor", "Inbox Interceptor", "Silver", "Timing", T(lambda s: s.done_same_day, 25)),
    ("clean-sweep", "Clean Sweep", "Silver", "Timing", F(lambda s: s.zero_overdue_now)),
    ("perfect-week", "Perfect Week", "Gold", "Timing", T(lambda s: s.perfect_weeks, 1)),
    ("perfect-month", "Perfect Month", "Platinum", "Timing", T(lambda s: s.perfect_months, 1)),
    ("deadline-dancer", "Deadline Dancer", "Bronze", "Timing", MANUAL),
    ("buzzer-beater", "Buzzer Beater", "Silver", "Timing", MANUAL),
    ("nothing-overdue", "Nothing Overdue", "Silver", "Timing", F(lambda s: s.zero_overdue_now)),
    ("nothing-overdue-2", "Nothing Overdue II", "Gold", "Timing", T(lambda s: s.zero_overdue_streak, 14)),
    ("nothing-overdue-3", "Nothing Overdue III", "Platinum", "Timing", T(lambda s: s.zero_overdue_streak, 60)),
    ("fast-follow", "Fast Follow", "Bronze", "Timing", MANUAL),

    # ---------------------------------------------------------- streaks (16)
    ("day-two", "Day Two", "Bronze", "Streaks", T(lambda s: s.longest_streak, 2)),
    ("working-week", "Working Week", "Bronze", "Streaks", T(lambda s: s.longest_streak, 7)),
    ("fortnight", "Fortnight", "Silver", "Streaks", T(lambda s: s.longest_streak, 14)),
    ("full-moon", "Full Moon", "Silver", "Streaks", T(lambda s: s.longest_streak, 30)),
    ("quarter-note", "Quarter Note", "Gold", "Streaks", T(lambda s: s.longest_streak, 90)),
    ("half-year", "Half Year", "Gold", "Streaks", T(lambda s: s.longest_streak, 180)),
    ("annual", "Annual", "Platinum", "Streaks", T(lambda s: s.longest_streak, 365)),
    ("unbroken", "Unbroken", "Mythic", "Streaks", T(lambda s: s.longest_streak, 730)),
    ("maxed-multiplier", "Maxed Multiplier", "Silver", "Streaks", T(lambda s: s.longest_streak, 15)),
    ("weekend-warrior", "Weekend Warrior", "Bronze", "Streaks", T(lambda s: s.weekend_pairs, 1)),
    ("four-weekends", "Four Weekends", "Silver", "Streaks", T(lambda s: s.weekend_pairs, 4)),
    ("freeze-frame", "Freeze Frame", "Bronze", "Streaks", T(lambda s: s.streak_freezes_used, 1)),
    ("didnt-need-it", "Didn't Need It", "Silver", "Streaks", MANUAL),
    ("back-on-horse", "Back on the Horse", "Bronze", "Streaks", MANUAL),
    ("longer-this-time", "Longer This Time", "Silver", "Streaks", F(lambda s: s.beat_longest_streak)),
    ("comeback-season", "Comeback Season", "Gold", "Streaks", MANUAL),

    # --------------------------------------------------------- recovery (12)
    ("debt-collector", "Debt Collector", "Bronze", "Recovery", T(lambda s: s.overdue_cleared, 1)),
    ("dig-out", "Dig Out", "Silver", "Recovery", T(lambda s: s.max_overdue_cleared_day, 5)),
    ("excavation", "Excavation", "Gold", "Recovery", T(lambda s: s.max_overdue_cleared_day, 15)),
    ("zero-balance", "Zero Balance", "Silver", "Recovery", MANUAL),
    ("necromancer", "Necromancer", "Silver", "Recovery", T(lambda s: s.revived_30d, 1)),
    ("archaeologist", "Archaeologist", "Gold", "Recovery", T(lambda s: s.revived_90d, 1)),
    ("unblocked", "Unblocked", "Bronze", "Recovery", T(lambda s: s.unblocked_completed, 1)),
    ("unblocker", "Unblocker", "Silver", "Recovery", T(lambda s: s.unblocked_completed, 10)),
    ("cut-the-rope", "Cut the Rope", "Silver", "Recovery", MANUAL),
    ("net-positive", "Net Positive", "Silver", "Recovery", MANUAL),
    ("damage-control", "Damage Control", "Gold", "Recovery", MANUAL),
    ("still-here", "Still Here", "Gold", "Recovery", MANUAL),

    # ---------------------------------------------------- study: cards (18)
    ("first-card", "First Card", "Bronze", "Study — flashcards", T(lambda s: s.cards_reviewed, 1)),
    ("hundred-cards", "Hundred Cards", "Bronze", "Study — flashcards", T(lambda s: s.cards_reviewed, 100)),
    ("five-hundred-cards", "Five Hundred Cards", "Silver", "Study — flashcards", T(lambda s: s.cards_reviewed, 500)),
    ("thousand-cards", "Thousand Cards", "Silver", "Study — flashcards", T(lambda s: s.cards_reviewed, 1000)),
    ("five-thousand-cards", "Five Thousand Cards", "Gold", "Study — flashcards", T(lambda s: s.cards_reviewed, 5000)),
    ("twenty-thousand-cards", "Twenty Thousand Cards", "Platinum", "Study — flashcards", T(lambda s: s.cards_reviewed, 20000)),
    ("daily-driver", "Daily Driver", "Bronze", "Study — flashcards", T(lambda s: s.scheduled_clear_streak, 1)),
    ("seven-clean-days", "Seven Clean Days", "Silver", "Study — flashcards", T(lambda s: s.scheduled_clear_streak, 7)),
    ("thirty-clean-days", "Thirty Clean Days", "Gold", "Study — flashcards", T(lambda s: s.scheduled_clear_streak, 30)),
    ("deck-cleared", "Deck Cleared", "Bronze", "Study — flashcards", T(lambda s: s.decks_cleared, 1)),
    ("deck-master", "Deck Master", "Silver", "Study — flashcards", MANUAL),
    ("honest-work", "Honest Work", "Bronze", "Study — flashcards", T(lambda s: s.graded_again, 1)),
    ("hard-mode", "Hard Mode", "Silver", "Study — flashcards", MANUAL),
    ("mature-collection", "Mature Collection", "Gold", "Study — flashcards", T(lambda s: s.mature_cards, 500)),
    ("card-author", "Card Author", "Bronze", "Study — flashcards", T(lambda s: s.cards_created, 1)),
    ("deck-builder", "Deck Builder", "Silver", "Study — flashcards", T(lambda s: s.cards_created, 100)),
    ("curriculum", "Curriculum", "Gold", "Study — flashcards", T(lambda s: s.cards_created, 500)),
    ("leech-hunter", "Leech Hunter", "Silver", "Study — flashcards", MANUAL),

    # ---------------------------------------------------- study: exams (14)
    ("pop-quiz", "Pop Quiz", "Bronze", "Study — exams", T(lambda s: s.quizzes_taken, 1)),
    ("test-taker", "Test Taker", "Bronze", "Study — exams", T(lambda s: s.tests_taken, 1)),
    ("full-length", "Full Length", "Silver", "Study — exams", T(lambda s: s.full_exams_taken, 1)),
    ("passing-grade", "Passing Grade", "Bronze", "Study — exams", T(lambda s: s.best_exam_pct, 65)),
    ("comfortable-pass", "Comfortable Pass", "Silver", "Study — exams", T(lambda s: s.best_full_exam_pct, 80)),
    ("exam-ready", "Exam Ready", "Gold", "Study — exams", T(lambda s: s.best_full_exam_pct, 90)),
    ("perfect-paper", "Perfect Paper", "Gold", "Study — exams", T(lambda s: s.perfect_tests, 1)),
    ("ten-exams", "Ten Exams", "Silver", "Study — exams", T(lambda s: s.full_exams_taken, 10)),
    ("fifty-exams", "Fifty Exams", "Gold", "Study — exams", T(lambda s: s.full_exams_taken, 50)),
    ("trending-up", "Trending Up", "Silver", "Study — exams", T(lambda s: s.exam_improve_streak, 3)),
    ("from-50-to-90", "From 50 to 90", "Gold", "Study — exams", MANUAL),
    ("no-timer-needed", "No Timer Needed", "Silver", "Study — exams", MANUAL),
    ("read-the-question", "Read the Question", "Bronze", "Study — exams", MANUAL),
    ("marathon", "Marathon", "Silver", "Study — exams", MANUAL),

    # -------------------------------------------- study: certifications (12)
    ("enrolled", "Enrolled", "Bronze", "Study — certifications", T(lambda s: s.study_plans, 1)),
    ("on-track", "On Track", "Silver", "Study — certifications", MANUAL),
    ("ahead-of-schedule", "Ahead of Schedule", "Gold", "Study — certifications", MANUAL),
    ("certified", "Certified", "Gold", "Study — certifications", T(lambda s: s.certs_passed, 1)),
    ("double-certified", "Double Certified", "Gold", "Study — certifications", T(lambda s: s.certs_passed, 2)),
    ("triple-threat", "Triple Threat", "Platinum", "Study — certifications", T(lambda s: s.certs_passed, 3)),
    ("five-badges", "Five Badges", "Platinum", "Study — certifications", T(lambda s: s.certs_passed, 5)),
    ("architect-track", "Architect Track", "Mythic", "Study — certifications", MANUAL),
    ("maintained", "Maintained", "Silver", "Study — certifications", MANUAL),
    ("no-lapses", "No Lapses", "Gold", "Study — certifications", MANUAL),
    ("first-try", "First Try", "Gold", "Study — certifications", T(lambda s: s.certs_first_try, 1)),
    ("second-times-charm", "Second Time's the Charm", "Silver", "Study — certifications", MANUAL),

    # --------------------------------------------------------- meetings (14)
    ("recorded", "Recorded", "Bronze", "Meetings", T(lambda s: s.meetings_imported, 1)),
    ("fifty-meetings", "Fifty Meetings", "Silver", "Meetings", T(lambda s: s.meetings_imported, 50)),
    ("two-hundred-meetings", "Two Hundred Meetings", "Gold", "Meetings", T(lambda s: s.meetings_imported, 200)),
    ("prepared", "Prepared", "Bronze", "Meetings", T(lambda s: s.meetings_with_agenda, 1)),
    ("always-prepared", "Always Prepared", "Silver", "Meetings", T(lambda s: s.meetings_with_agenda, 25)),
    ("action-extractor", "Action Extractor", "Bronze", "Meetings", T(lambda s: s.max_tasks_one_meeting, 5)),
    ("ten-out-of-one", "Ten Out of One", "Silver", "Meetings", T(lambda s: s.max_tasks_one_meeting, 10)),
    ("meeting-to-done", "Meeting to Done", "Bronze", "Meetings", T(lambda s: s.meetings_fully_closed, 1)),
    ("clean-slate", "Clean Slate", "Silver", "Meetings", T(lambda s: s.meetings_fully_closed, 10)),
    ("standup-regular", "Standup Regular", "Silver", "Meetings", MANUAL),
    ("note-taker", "Note Taker", "Silver", "Meetings", MANUAL),
    ("follow-through", "Follow Through", "Gold", "Meetings", MANUAL),
    ("quiet-week", "Quiet Week", "Bronze", "Meetings", MANUAL),
    ("meeting-marathon", "Meeting Marathon", "Bronze", "Meetings", T(lambda s: s.max_meetings_day, 6)),

    # ---------------------------------------------------------- rituals (14)
    ("intentional", "Intentional", "Bronze", "Rituals", T(lambda s: s.intention_days, 1)),
    ("morning-person", "Morning Person", "Bronze", "Rituals", T(lambda s: s.intentions_before_8, 1)),
    ("seven-intentions", "Seven Intentions", "Bronze", "Rituals", T(lambda s: s.intention_streak, 7)),
    ("thirty-intentions", "Thirty Intentions", "Silver", "Rituals", T(lambda s: s.intention_streak, 30)),
    ("hundred-intentions", "Hundred Intentions", "Gold", "Rituals", T(lambda s: s.intention_streak, 100)),
    ("logged", "Logged", "Bronze", "Rituals", T(lambda s: s.worklog_entries, 1)),
    ("hundred-entries", "Hundred Entries", "Silver", "Rituals", T(lambda s: s.worklog_entries, 100)),
    ("thousand-entries", "Thousand Entries", "Gold", "Rituals", T(lambda s: s.worklog_entries, 1000)),
    ("full-log", "Full Log", "Bronze", "Rituals", T(lambda s: s.full_log_days, 1)),
    ("closed-loop", "Closed Loop", "Bronze", "Rituals", T(lambda s: s.eod_completes, 1)),
    ("thirty-closes", "Thirty Closes", "Silver", "Rituals", T(lambda s: s.eod_completes, 30)),
    ("hundred-closes", "Hundred Closes", "Gold", "Rituals", T(lambda s: s.eod_completes, 100)),
    ("full-house", "Full House", "Silver", "Rituals", T(lambda s: s.full_house_days, 1)),
    ("perfect-ritual-week", "Perfect Ritual Week", "Gold", "Rituals", T(lambda s: s.full_house_streak, 5)),

    # ---------------------------------------------------------- reviews (10)
    ("reviewer", "Reviewer", "Bronze", "Reviews", T(lambda s: s.weekly_reviews, 1)),
    ("four-weeks", "Four Weeks", "Silver", "Reviews", T(lambda s: s.weekly_review_streak, 4)),
    ("twelve-weeks", "Twelve Weeks", "Gold", "Reviews", T(lambda s: s.weekly_review_streak, 12)),
    ("fifty-two", "Fifty Two", "Platinum", "Reviews", T(lambda s: s.weekly_reviews, 52)),
    ("monthly-check", "Monthly Check", "Bronze", "Reviews", T(lambda s: s.monthly_reviews, 1)),
    ("quarter-reviewed", "Quarter Reviewed", "Silver", "Reviews", T(lambda s: s.monthly_review_streak, 3)),
    ("year-reviewed", "Year Reviewed", "Gold", "Reviews", T(lambda s: s.monthly_reviews, 12)),
    ("carry-forward", "Carry Forward", "Bronze", "Reviews", MANUAL),
    ("honest-accounting", "Honest Accounting", "Silver", "Reviews", MANUAL),
    ("nothing-stalled", "Nothing Stalled", "Gold", "Reviews", MANUAL),

    # ------------------------------------------------ projects and bosses (12)
    ("first-boss", "First Boss", "Bronze", "Projects", T(lambda s: s.projects_completed, 1)),
    ("boss-rush", "Boss Rush", "Silver", "Projects", T(lambda s: s.projects_completed, 5)),
    ("campaign", "Campaign", "Gold", "Projects", T(lambda s: s.projects_completed, 20)),
    ("overkill", "Overkill", "Bronze", "Projects", MANUAL),
    ("final-blow", "Final Blow", "Bronze", "Projects", T(lambda s: s.projects_completed, 1)),
    ("solo-run", "Solo Run", "Silver", "Projects", T(lambda s: s.max_project_tasks, 15)),
    ("raid-boss", "Raid Boss", "Gold", "Projects", T(lambda s: s.max_project_tasks, 40)),
    ("no-retreat", "No Retreat", "Gold", "Projects", MANUAL),
    ("long-campaign", "Long Campaign", "Silver", "Projects", MANUAL),
    ("two-fronts", "Two Fronts", "Silver", "Projects", MANUAL),
    ("cleared-the-board", "Cleared the Board", "Gold", "Projects", MANUAL),
    ("scope-cut", "Scope Cut", "Bronze", "Projects", MANUAL),

    # ------------------------------------------------- salesforce craft (16)
    ("deployed", "Deployed", "Bronze", "Salesforce", T(lambda s: s.deploy_tasks, 1)),
    ("ten-deploys", "Ten Deploys", "Silver", "Salesforce", T(lambda s: s.deploy_tasks, 10)),
    ("fifty-deploys", "Fifty Deploys", "Gold", "Salesforce", T(lambda s: s.deploy_tasks, 50)),
    ("sandbox-refreshed", "Sandbox Refreshed", "Silver", "Salesforce", T(lambda s: s.sandbox_tasks, 1)),
    ("full-refresh-cycle", "Full Refresh Cycle", "Gold", "Salesforce", MANUAL),
    ("permission-surgeon", "Permission Surgeon", "Silver", "Salesforce", T(lambda s: s.permission_tasks, 10)),
    ("least-privilege", "Least Privilege", "Gold", "Salesforce", MANUAL),
    ("integration-wrangler", "Integration Wrangler", "Silver", "Salesforce", T(lambda s: s.integration_tasks, 10)),
    ("data-mover", "Data Mover", "Silver", "Salesforce", T(lambda s: s.data_tasks, 10)),
    ("bug-squasher", "Bug Squasher", "Bronze", "Salesforce", T(lambda s: s.bug_tasks, 10)),
    ("exterminator", "Exterminator", "Gold", "Salesforce", T(lambda s: s.bug_tasks, 100)),
    ("sprint-closer", "Sprint Closer", "Silver", "Salesforce", MANUAL),
    ("ticket-to-ride", "Ticket to Ride", "Silver", "Salesforce", T(lambda s: s.req_tasks, 50)),
    ("production-careful", "Production Careful", "Gold", "Salesforce", MANUAL),
    ("release-manager", "Release Manager", "Gold", "Salesforce", MANUAL),
    ("org-whisperer", "Org Whisperer", "Platinum", "Salesforce", T(lambda s: s.salesforce_tasks, 500)),

    # -------------------------------------------------- vault knowledge (14)
    ("first-note", "First Note", "Bronze", "Vault", T(lambda s: s.note_count, 1)),
    ("hundred-notes", "Hundred Notes", "Silver", "Vault", T(lambda s: s.note_count, 100)),
    ("five-hundred-notes", "Five Hundred Notes", "Silver", "Vault", T(lambda s: s.note_count, 500)),
    ("thousand-notes", "Thousand Notes", "Gold", "Vault", T(lambda s: s.note_count, 1000)),
    ("connected", "Connected", "Bronze", "Vault", MANUAL),
    ("web-weaver", "Web Weaver", "Silver", "Vault", MANUAL),
    ("decided", "Decided", "Bronze", "Vault", MANUAL),
    ("ten-decisions", "Ten Decisions", "Silver", "Vault", MANUAL),
    ("inbox-zero", "Inbox Zero", "Bronze", "Vault", MANUAL),
    ("inbox-zero-streak", "Inbox Zero Streak", "Silver", "Vault", MANUAL),
    ("gardener", "Gardener", "Silver", "Vault", MANUAL),
    ("no-orphans", "No Orphans", "Gold", "Vault", MANUAL),
    ("templated", "Templated", "Bronze", "Vault", MANUAL),
    ("automated", "Automated", "Silver", "Vault", MANUAL),

    # ------------------------------------------- time of day and calendar (14)
    ("dawn-patrol", "Dawn Patrol", "Bronze", "Time of day", T(lambda s: s.before_6, 1)),
    ("before-the-coffee", "Before the Coffee", "Silver", "Time of day", T(lambda s: s.before_8, 25)),
    ("night-owl", "Night Owl", "Bronze", "Time of day", T(lambda s: s.after_23, 1)),
    ("midnight-oil", "Burning the Midnight Oil", "Silver", "Time of day", T(lambda s: s.after_23, 25)),
    ("lunch-break", "Lunch Break", "Bronze", "Time of day", MANUAL),
    ("bookends", "Bookends", "Bronze", "Time of day", T(lambda s: s.bookend_days, 1)),
    ("weekend-shift", "Weekend Shift", "Bronze", "Time of day", T(lambda s: s.saturday_tasks_max, 5)),
    ("monday-momentum", "Monday Momentum", "Silver", "Time of day", T(lambda s: s.monday_tasks_max, 10)),
    ("friday-finisher", "Friday Finisher", "Silver", "Time of day", MANUAL),
    ("leap-day", "Leap Day", "Bronze", "Time of day", MANUAL),
    ("new-year-new-task", "New Year, New Task", "Bronze", "Time of day", MANUAL),
    ("birthday-work", "Birthday Work", "Bronze", "Time of day", MANUAL),
    ("holiday-hours", "Holiday Hours", "Bronze", "Time of day", MANUAL),
    ("quarter-close", "Quarter Close", "Silver", "Time of day", MANUAL),

    # ------------------------------------------------------------ triage (10)
    ("triaged", "Triaged", "Bronze", "Triage", T(lambda s: s.manual_difficulty, 1)),
    ("calibrator", "Calibrator", "Silver", "Triage", T(lambda s: s.manual_difficulty, 25)),
    ("trust-the-rules", "Trust the Rules", "Silver", "Triage", MANUAL),
    ("sorted", "Sorted", "Bronze", "Triage", T(lambda s: s.fully_triaged_days, 1)),
    ("sorted-streak", "Sorted Streak", "Silver", "Triage", T(lambda s: s.fully_triaged_streak, 7)),
    ("pruner", "Pruner", "Bronze", "Triage", MANUAL),
    ("ruthless", "Ruthless", "Silver", "Triage", MANUAL),
    ("right-sized", "Right-Sized", "Silver", "Triage", MANUAL),
    ("dated", "Dated", "Bronze", "Triage", MANUAL),
    ("provenance", "Provenance", "Silver", "Triage", MANUAL),

    # ---------------------------------------------- people collaboration (10)
    ("handed-off", "Handed Off", "Bronze", "People", MANUAL),
    ("good-teammate", "Good Teammate", "Silver", "People", MANUAL),
    ("fast-reply", "Fast Reply", "Bronze", "People", MANUAL),
    ("nobody-waiting", "Nobody Waiting", "Silver", "People", MANUAL),
    ("follow-up", "Follow Up", "Bronze", "People", MANUAL),
    ("chased-it-down", "Chased It Down", "Silver", "People", MANUAL),
    ("sign-off", "Sign Off", "Silver", "People", MANUAL),
    ("onboarder", "Onboarder", "Silver", "People", MANUAL),
    ("escalated-well", "Escalated Well", "Silver", "People", MANUAL),
    ("room-of-ones-own", "Room of One's Own", "Bronze", "People", MANUAL),

    # -------------------------------------------------- meta self-aware (12)
    ("tomorrows-problem", "Tomorrow's Problem", "Bronze", "Meta", T(lambda s: s.reschedule_max, 3)),
    ("tomorrows-problem-2", "Tomorrow's Problem II", "Silver", "Meta", T(lambda s: s.reschedule_max, 10)),
    ("optimist", "Optimist", "Bronze", "Meta", MANUAL),
    ("realist", "Realist", "Silver", "Meta", MANUAL),
    ("yak-shaver", "Yak Shaver", "Bronze", "Meta", MANUAL),
    ("scope-creep", "Scope Creep", "Bronze", "Meta", MANUAL),
    ("honest-difficulty", "Honest Difficulty", "Silver", "Meta", MANUAL),
    ("read-the-manual", "Read the Manual", "Bronze", "Meta", MANUAL),
    ("achievement-hunter", "Achievement Hunter", "Silver", "Meta", T(lambda s: s.achievements_unlocked, 50)),
    ("completionist", "Completionist", "Gold", "Meta", T(lambda s: s.achievements_unlocked, 150)),
    ("full-dex", "Full Dex", "Mythic", "Meta", MANUAL),
    ("touch-grass", "Touch Grass", "Bronze", "Meta", T(lambda s: s.vacation_weeks, 1)),

    # ----------------------------------------------------------- hidden (10)
    ("ghost-in-machine", "Ghost in the Machine", "Hidden", "Hidden", MANUAL),
    ("exactly-42", "Exactly 42", "Hidden", "Hidden", MANUAL),
    ("nice", "Nice", "Hidden", "Hidden", MANUAL),
    ("round-numbers", "Round Numbers", "Hidden", "Hidden", MANUAL),
    ("zero-day", "Zero Day", "Hidden", "Hidden", MANUAL),
    ("palindrome", "Palindrome", "Hidden", "Hidden", MANUAL),
    ("speedrun", "Speedrun", "Hidden", "Hidden", MANUAL),
    ("any-percent", "Any%", "Hidden", "Hidden", MANUAL),
    ("the-long-game", "The Long Game", "Hidden", "Hidden", MANUAL),
    ("phoenix", "Phoenix", "Hidden", "Hidden", MANUAL),

    # -------------------------------------------------- exam readiness (9)
    ("calibrated", "Calibrated", "Silver", "Exam readiness", MANUAL),
    ("green-light", "Green Light", "Silver", "Exam readiness", T(lambda s: s.max_readiness, 90)),
    ("no-weak-domain", "No Weak Domain", "Silver", "Exam readiness", F(lambda s: s.no_weak_domain)),
    ("full-blueprint", "Full Blueprint", "Gold", "Exam readiness", F(lambda s: s.full_blueprint_coverage)),
    ("trusted-the-model", "Trusted the Model", "Gold", "Exam readiness", MANUAL),
    ("stability", "Stability", "Silver", "Exam readiness", MANUAL),
    ("no-retakes", "No Retakes", "Gold", "Exam readiness", F(lambda s: s.readiness_no_retakes)),
    ("sat-it-anyway", "Sat It Anyway", "Silver", "Exam readiness", MANUAL),
    ("back-in", "Back In", "Silver", "Exam readiness", MANUAL),
]


def auto_count() -> int:
    return sum(1 for a in CATALOG if a[4] is not MANUAL)


def evaluate(stats: Stats, already: set[str]) -> list[tuple[str, str, str, int]]:
    """Return newly earned achievements as (slug, name, tier, xp)."""
    earned = []
    for slug, name, tier, _cat, pred in CATALOG:
        if slug in already or pred is MANUAL:
            continue
        try:
            if pred(stats):
                earned.append((slug, name, tier, TIER_XP[tier]))
        except Exception:
            continue
    return earned


def _shipped_conditions() -> dict[str, str]:
    """Condition wording that travels with the code.

    The note is the editable source of truth, but a vault whose note has not
    been written yet would otherwise show 258 achievements and no explanation
    of any of them.
    """
    try:
        import json
        return json.loads((Path(__file__).with_name("conditions.json"))
                          .read_text(encoding="utf-8"))
    except Exception:
        return {}


SHIPPED_CONDITIONS = _shipped_conditions()


def snapshot(stats: Stats, unlocked: dict[str, str],
             conditions: dict[str, str]) -> list[dict]:
    """The whole catalog with progress, for the UI to render.

    `conditions` maps slug -> the human-readable condition text from the
    Achievements note, so the popup and the browser can explain what was earned
    without duplicating the wording in two places.
    """
    out = []
    for slug, name, tier, cat, pred in CATALOG:
        row = {"slug": slug, "name": name, "tier": tier, "category": cat,
               "xp": TIER_XP[tier], "manual": pred is MANUAL,
               "condition": conditions.get(slug) or SHIPPED_CONDITIONS.get(slug, ""),
               "unlocked": unlocked.get(slug)}
        if pred is not MANUAL and isinstance(pred, Spec):
            try:
                have, need = pred.progress(stats)
                row["have"], row["need"] = round(have, 2), round(need, 2)
                row["progress"] = round(min(1.0, have / need), 4) if need else 0.0
            except Exception:
                row["have"], row["need"], row["progress"] = 0, 1, 0.0
        else:
            row["have"] = 1 if row["unlocked"] else 0
            row["need"] = 1
            row["progress"] = 1.0 if row["unlocked"] else 0.0
        if row["unlocked"]:
            row["progress"] = 1.0
        out.append(row)
    return out


if __name__ == "__main__":
    total, auto = len(CATALOG), auto_count()
    print(f"{total} achievements, {auto} auto-evaluated, {total - auto} manual")
    slugs = [a[0] for a in CATALOG]
    dupes = {s for s in slugs if slugs.count(s) > 1}
    print("duplicate slugs:", dupes or "none")
    from collections import Counter
    for cat, n in Counter(a[3] for a in CATALOG).most_common():
        print(f"  {n:3d}  {cat}")
