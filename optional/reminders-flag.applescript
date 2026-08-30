on run argv
  if (count of argv) < 1 then return "missing arguments"
  if (item 1 of argv) is "--read" then
    if (count of argv) < 2 then return ""
    set wantedIds to items 2 thru -1 of argv
    set outputLines to {}
    tell application "Reminders"
      repeat with reminderList in every list
        repeat with reminderItem in every reminder of reminderList
          set reminderId to (id of reminderItem) as text
          set bridgeId to text 20 thru -1 of reminderId
          if bridgeId is in wantedIds then
            set end of outputLines to bridgeId & tab & ((flagged of reminderItem) as text)
          end if
        end repeat
      end repeat
    end tell
    set AppleScript's text item delimiters to linefeed
    set outputText to outputLines as text
    set AppleScript's text item delimiters to ""
    return outputText
  end if
  if (item 1 of argv) is "--set" then
    if (count of argv) < 3 then return "missing arguments"
    tell application "Reminders"
      repeat with reminderList in every list
        repeat with reminderItem in every reminder of reminderList
          set reminderId to (id of reminderItem) as text
          set bridgeId to text 20 thru -1 of reminderId
          repeat with pairIndex from 2 to (count of argv) by 2
            if bridgeId is (item pairIndex of argv) then
              set flagged of reminderItem to ((item (pairIndex + 1) of argv) is "true")
              exit repeat
            end if
          end repeat
        end repeat
      end repeat
    end tell
    return "ok"
  end if
  if (count of argv) < 2 then return "missing arguments"
  set wantedId to item 1 of argv
  set wantedFlag to (item 2 of argv is "true")
  tell application "Reminders"
    repeat with reminderItem in every reminder of every list
      set reminderId to (id of reminderItem) as text
      if reminderId is wantedId or reminderId is ("x-apple-reminder://" & wantedId) then
        set flagged of reminderItem to wantedFlag
        return "ok"
      end if
    end repeat
  end tell
  return "not found"
end run
