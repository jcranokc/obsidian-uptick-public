-- Return the first selected Apple Mail message for the email-task companion.
-- Output is metadata, a marker, then the message body; the opaque locator is
-- consumed by local state only and is never written into task text.
on run
  tell application "Mail"
    set chosen to selection
    if (count of chosen) is 0 then error "Select an Apple Mail message first"
    set messageItem to item 1 of chosen
    set mid to message id of messageItem
    set subjectLine to subject of messageItem
    set messageURL to "message://" & mid
    set messageBody to ""
    try
      set messageBody to content of messageItem
    end try
    return mid & tab & subjectLine & tab & messageURL & return & "---UPTICK-BODY---" & return & messageBody
  end tell
end run
