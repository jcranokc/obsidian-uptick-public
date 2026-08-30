/* Enough of moment for the dashboards to run under test. Not a date library —
 * just the surface main.js actually touches. */
function pad(n) { return String(n).padStart(2, "0"); }

function wrap(d, valid = true) {
  const o = {
    _d: d,
    isValid: () => valid && !Number.isNaN(d.getTime()),
    format: (f) => {
      if (!f) return d.toISOString();
      if (f === "YYYY-MM-DD") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (f === "W") return "34";
      if (f === "YYYY") return String(d.getFullYear());
      if (f === "MMMM YYYY") return "August 2026";
      if (f === "dddd, MMMM D, YYYY") return "Sunday, August 23, 2026";
      if (f === "dddd") return "Sunday";
      if (f === "h:mm A") return "10:00 AM";
      if (f === "D MMM") return "23 Aug";
      return d.toISOString();
    },
    clone: () => wrap(new Date(d.getTime()), valid),
    add: () => o, subtract: () => o,
    startOf: () => o, endOf: () => o, isoWeek: () => o,
    /* moment's accessors are getter/setters: called with an argument they set
       and return the moment, called bare they return a number. Returning the
       number in both cases is what made `day.clone().date(n)` yield an integer
       and blow up on `.isSame`. */
    hour: (v) => (v === undefined ? d.getHours() : o),
    day: (v) => (v === undefined ? d.getDay() : o),
    date: (v) => (v === undefined ? d.getDate() : o),
    valueOf: () => d.getTime(),
    toDate: () => d,
    diff: () => 0,
    isSame: () => true, isBefore: () => false, isAfter: () => false,
    isSameOrAfter: () => true, isSameOrBefore: () => true,
    isBetween: () => true,
    fromNow: () => "just now",
    daysInMonth: () => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
    week: (v) => (v === undefined ? 34 : o),
    month: (v) => (v === undefined ? d.getMonth() : o),
    year: (v) => (v === undefined ? d.getFullYear() : o),
    weekday: (v) => (v === undefined ? d.getDay() : o),
    minutes: (v) => (v === undefined ? d.getMinutes() : o),
    set: () => o, get: () => 0, unix: () => Math.floor(d.getTime() / 1000),
    local: () => o, utc: () => o, toISOString: () => d.toISOString(),
  };
  return o;
}

function m(v, fmt, strict) {
  if (v === undefined || v === null) return wrap(new Date("2026-08-23T10:00:00"));
  if (typeof v === "object" && v && typeof v.format === "function") return v;
  const d = new Date(v);
  /* Strict parsing is used to decide whether a string is a real date; return an
   * invalid moment rather than throwing, which is what the real library does. */
  const valid = !Number.isNaN(d.getTime());
  return wrap(valid ? d : new Date("2026-08-23T10:00:00"), valid);
}
m.utc = m;
m.duration = () => ({ asDays: () => 0, humanize: () => "a moment" });
module.exports = m;
