"""Create one static font from a named variable-font instance.

FontTools 4.51.0 is bundled in vendor/fonttools-4.51.0.zip under its MIT license.
"""

import json
import os
import re
import sys


script_dir = os.environ["FONT_INSTALLER_SCRIPT_DIR"]
sys.path.insert(0, os.path.join(script_dir, "vendor", "fonttools-4.51.0.zip"))

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


source = os.environ["FONT_INSTALLER_INPUT"]
destination = os.environ["FONT_INSTALLER_OUTPUT"]
axes = json.loads(os.environ["FONT_INSTALLER_AXES"])

font = TTFont(source)
if "fvar" not in font:
    raise ValueError("输入文件不是可变字体")
supported_axes = {axis.axisTag for axis in font["fvar"].axes}
if not axes or not set(axes).issubset(supported_axes):
    raise ValueError("所选字重与字体变体不匹配")

instance = instantiateVariableFont(font, axes, inplace=False, updateFontNames=True)
family = os.environ["FONT_INSTALLER_FAMILY"]
style = os.environ["FONT_INSTALLER_STYLE"]
full_name = os.environ["FONT_INSTALLER_FULL_NAME"]
postscript = os.environ["FONT_INSTALLER_POSTSCRIPT"]
if not re.fullmatch(r"[A-Za-z0-9._-]+", postscript):
    raise ValueError("生成的 PostScript 名称无效")

# FontTools may keep the variable font's original PostScript name for some
# named instances. Give every static payload its own stable identity.
name_table = instance["name"]
replacement_names = {
    1: family,
    2: style,
    4: full_name,
    6: postscript,
    16: family,
    17: style,
}
name_table.names = [record for record in name_table.names if record.nameID not in replacement_names]
for name_id, value in replacement_names.items():
    name_table.setName(value, name_id, 3, 1, 0x0409)
    name_table.setName(value, name_id, 0, 3, 0)

instance.save(destination)
