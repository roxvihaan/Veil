on run argv
  set actionName to item 1 of argv
  tell application id "com.spotify.client"
    if actionName is "status" then
      set playbackState to player state as text
      set volumeLevel to sound volume as text
      if player state is stopped then return {playbackState, volumeLevel}
      set song to current track
      if song is missing value then return {playbackState, volumeLevel}
      return {playbackState, volumeLevel, name of song, artist of song, album of song, spotify url of song}
    else if actionName is "play" then
      play
    else if actionName is "pause" then
      pause
    else if actionName is "toggle" then
      playpause
    else if actionName is "next" then
      next track
    else if actionName is "previous" then
      previous track
    else if actionName is "volume" then
      if (count of argv) is 2 then set sound volume to (item 2 of argv as integer)
      return {sound volume as text}
    end if
  end tell
  return {}
end run
