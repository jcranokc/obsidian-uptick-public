on run argv
  if (count of argv) is 0 then error "A Mail message URL is required"
  set mailURL to item 1 of argv
  if mailURL does not start with "message://" and mailURL does not start with "x-apple-data-detectors://" then
    error "Only Apple Mail message URLs are accepted"
  end if
  open location mailURL
end run
