#!/usr/bin/osascript
-- Read new messages from Apple Mail's Sent mailbox for the local completion companion.
-- Output is tab-delimited metadata, a body marker, then a message separator.
on run argv
  set sinceEpoch to (item 1 of argv) as real
  set cutoff to (date "Thursday, January 1, 1970 12:00:00 AM") + sinceEpoch
  tell application "Mail"
    set output to ""
    repeat with accountItem in accounts
      try
        set sentBox to mailbox "Sent" of accountItem
        repeat with messageItem in (messages of sentBox whose date sent is greater than cutoff)
          set mid to message id of messageItem
          set subjectLine to subject of messageItem
          set sentAt to (date sent of messageItem) as string
          set replyTo to ""
          try
            set rawSource to source of messageItem
            set replyMatch to rawSource's paragraphs
            repeat with sourceLine in replyMatch
              if (sourceLine as text) starts with "In-Reply-To:" then
                set replyTo to text 13 thru -1 of (sourceLine as text)
                exit repeat
              end if
            end repeat
          end try
          set messageBody to ""
          try
            set messageBody to content of messageItem
          end try
          set output to output & mid & tab & subjectLine & tab & sentAt & tab & replyTo & return & "---UPTICK-BODY---" & return & messageBody & return & "---UPTICK-MESSAGE---" & return
        end repeat
      end try
    end repeat
    return output
  end tell
end run
