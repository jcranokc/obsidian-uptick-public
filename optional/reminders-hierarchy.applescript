#!/usr/bin/osascript
-- Create native Reminders parent/child relationships. The CLI companion does
-- not expose this relationship, while Reminders' scripting dictionary does.
on run argv
  if (count of argv) < 3 then error "usage: --create LIST PARENT [CHILD ...] or --child PARENT_ID CHILD"
  set mode to item 1 of argv
  if mode is "--child" then
    set parentID to item 2 of argv
    set childName to item 3 of argv
    tell application "Reminders"
      repeat with accountItem in accounts
        try
          set parentReminder to some reminder of accountItem whose id is parentID
          set childReminder to make new reminder at end of parentReminder with properties {name:childName}
          return id of childReminder
        end try
      end repeat
    end tell
    error "parent reminder not found"
  end if
  if mode is not "--create" then error "only --create and --child are supported"
  set listName to item 2 of argv
  set parentName to item 3 of argv
  tell application "Reminders"
    set targetList to list listName
    set parentReminder to make new reminder at end of targetList with properties {name:parentName}
    set childNames to items 4 thru (count of argv)
    repeat with childName in childNames
      make new reminder at end of parentReminder with properties {name:(contents of childName)}
    end repeat
    return id of parentReminder
  end tell
end run
