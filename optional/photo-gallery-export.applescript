-- Export a random sample from named Photos albums.
--
-- Photos' AppleScript dictionary exposes regular albums but NOT iCloud Shared
-- Albums, so the albums named here must be ordinary albums in the local
-- library. Originals are exported to a temp folder; the caller downscales them
-- before anything lands in the vault, so full-resolution images never sync.
--
-- Read-only with respect to the library: nothing is edited, moved, or deleted.
--
-- usage: osascript photo-gallery-export.applescript <destDir> <perAlbum> <album>...

on run argv
	if (count of argv) < 3 then return "usage: <destDir> <perAlbum> <album>..."
	set destPath to item 1 of argv
	set perAlbum to (item 2 of argv) as integer
	set albumNames to items 3 thru -1 of argv
	set dest to POSIX file destPath as alias

	set exported to 0
	with timeout of 600 seconds
		tell application "Photos"
			repeat with wanted in albumNames
				try
					set a to album (wanted as string)
					set items_ to media items of a
					set total to count of items_
					if total > 0 then
						-- Sample across the album rather than taking the first N,
						-- so the gallery is not always the oldest photos.
						set picks to {}
						set tries to 0
						repeat while (count of picks) < perAlbum and tries < (perAlbum * 12)
							set tries to tries + 1
							set idx to (random number from 1 to total)
							if picks does not contain idx then set end of picks to idx
							if (count of picks) ≥ total then exit repeat
						end repeat
						set chosen to {}
						repeat with i in picks
							set end of chosen to item i of items_
						end repeat
						if (count of chosen) > 0 then
							export chosen to dest without using originals
							set exported to exported + (count of chosen)
						end if
					end if
				on error errMsg number errNum
					-- One missing album must not lose the others.
					log "album " & (wanted as string) & " failed: " & errMsg
				end try
			end repeat
		end tell
	end timeout
	return "exported:" & exported
end run
