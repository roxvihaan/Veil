"""Check the actual Finder metadata stored inside the mounted disk image."""
import sys
from pathlib import Path
from ds_store import DSStore
from mac_alias import Alias

mount = Path(sys.argv[1])
with DSStore.open(str(mount / ".DS_Store"), "r") as store:
    window = store["."]["bwsp"]
    assert window["WindowBounds"] == "{{200, 180}, {760, 480}}", window
    for flag in ("ShowStatusBar", "ShowTabView", "ShowToolbar", "ShowPathbar", "ShowSidebar"):
        assert window[flag] is False, flag
    view = store["."]["icvp"]
    assert view["iconSize"] == 144, view
    assert view["textSize"] == 15, view
    assert view["arrangeBy"] == "none", view
    assert view["backgroundType"] == 2, view
    assert view["scrollPositionX"] == 0 and view["scrollPositionY"] == 0, view
    assert store["Veil Terminal.app"]["Iloc"] == (210, 246)
    assert store["Applications"]["Iloc"] == (550, 246)
    assert Alias.from_bytes(view["backgroundImageAlias"]).target.filename == ".background.tiff"
assert (mount / ".background.tiff").is_file()
print("PASS: 760x480 Finder window, 144-point icons, Retina background binding and fixed drag layout")
