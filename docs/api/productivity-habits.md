# Habit frequency and schedule updates

`PATCH /habits/:id` uses explicit schedule replacement:

- Omitting `schedules` preserves the existing schedules.
- Sending `schedules: []` removes all schedules.
- Sending a non-empty array replaces all schedules.

The resulting schedules must match the resulting `frequencyType`. DAILY
schedules cannot specify weekdays. WEEKLY habits require at least one schedule,
and every schedule must specify `dayOfWeek` (1–7). CUSTOM supports selected days
or schedules without a weekday. MONTHLY is not supported.

For example, changing a weekly habit to daily without scheduled times:

```json
{ "frequencyType": "DAILY", "schedules": [] }
```

Changing a daily habit to weekly:

```json
{
  "frequencyType": "WEEKLY",
  "schedules": [{ "dayOfWeek": 2, "timeOfDay": "07:30" }]
}
```

An incompatible frequency/schedule combination returns HTTP 400 without saving
the update. The API never silently deletes schedules when frequency changes.
