/** 9am tomorrow, local time: when a snooze from the row button or the S key ends. */
export function tomorrowMorning(): number {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next.getTime();
}
