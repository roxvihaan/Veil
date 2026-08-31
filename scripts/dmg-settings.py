"""Installer window metadata, written directly without automating Finder."""

format = "UDZO"
filesystem = "HFS+"
files = [defines["app"]]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]
background = defines["background"]

window_rect = ((200, 180), (760, 480))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_icon_preview = False
include_icon_view_settings = True
include_list_view_settings = False
arrange_by = None
icon_size = 144
text_size = 15
label_pos = "bottom"
icon_locations = {"Veil Terminal.app": (210, 246), "Applications": (550, 246)}
# Do not use hide_extensions/SetFile on the signed app: FinderInfo xattrs
# added after signing fail codesign's strict resource checks.
hide_extensions = []
