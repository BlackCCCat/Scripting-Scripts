local kAccepted = 1
local kNoop = 2

local T9_LETTER_TO_DIGIT = {
  a = "2",
  b = "2",
  c = "2",
  d = "3",
  e = "3",
  f = "3",
  g = "4",
  h = "4",
  i = "4",
  j = "5",
  k = "5",
  l = "5",
  m = "6",
  n = "6",
  o = "6",
  p = "7",
  q = "7",
  r = "7",
  s = "7",
  t = "8",
  u = "8",
  v = "8",
  w = "9",
  x = "9",
  y = "9",
  z = "9",
}

local PINYIN_SYLLABLES = [[
a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong
chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan
dui dun duo e ei en eng er fa fan fang fei fen feng fo fou fu ga gai gan gang gao
ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha hai han hang hao
he hei hen heng hm hng hong hou hu hua huai huan huang hui hun huo ji jia jian jiang jiao
jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke ken keng kong kou ku
kua kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang
liao lie lin ling liu lo long lou lu luan lun luo lv lve m ma mai man mang mao me
mei men meng mi mian miao mie min ming miu mo mou mu n na nai nan nang nao ne nei
nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve o ou pa
pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu qi qia qian
qiang qiao qie qin qing qiong qiu qu quan que qun ran rang rao re ren reng ri
rong rou ru ruan rui run ruo sa sai san sang sao se sen seng sha shai shan shang
shao she shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song
sou su suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou
tu tuan tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie
xin xing xiong xiu xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu
yuan yue yun za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhen
zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu
zuan zui zun zuo
]]

local VALID_SYLLABLE = {}
for syllable in PINYIN_SYLLABLES:gmatch("%S+") do
  VALID_SYLLABLE[syllable] = true
end

local STATE = {
  input = "",
  selected = {},
  capture = false,
  pending = "",
}

local function t9_digits_for_pinyin(text)
  local digits = {}
  for ch in text:lower():gmatch("[a-z]") do
    digits[#digits + 1] = T9_LETTER_TO_DIGIT[ch] or ""
  end
  return table.concat(digits)
end

local function selected_digit_prefix(selected)
  local parts = {}
  for _, syllable in ipairs(selected) do
    parts[#parts + 1] = t9_digits_for_pinyin(syllable)
  end
  return table.concat(parts)
end

local function digit_input(input)
  if input == nil then return "" end
  return (input:gsub("[^2-9]", ""))
end

local function sync_state_with_input(input)
  local digits = digit_input(input)
  if digits == "" then
    STATE.input = ""
    STATE.selected = {}
    STATE.capture = false
    STATE.pending = ""
    return
  end

  if STATE.input == digits then return end

  local kept = {}
  local consumed = ""
  for _, syllable in ipairs(STATE.selected) do
    local next_consumed = consumed .. t9_digits_for_pinyin(syllable)
    if digits:sub(1, #next_consumed) ~= next_consumed then break end
    kept[#kept + 1] = syllable
    consumed = next_consumed
  end

  STATE.input = digits
  STATE.selected = kept
  STATE.capture = false
  STATE.pending = ""
end

local function selection_cursor(digits, selected)
  local consumed = selected_digit_prefix(selected)
  if #consumed < #digits then
    return #selected + 1
  end
  if #selected > 0 then
    return #selected
  end
  return 1
end

local function apply_syllable(input, syllable)
  syllable = (syllable or ""):lower()
  if not VALID_SYLLABLE[syllable] then return false end

  local digits = digit_input(input)
  if digits == "" then return false end

  sync_state_with_input(digits)

  local index = selection_cursor(digits, STATE.selected)
  local next_selected = {}
  for i = 1, index - 1 do
    next_selected[i] = STATE.selected[i]
  end
  next_selected[index] = syllable

  STATE.input = digits
  STATE.selected = next_selected
  STATE.capture = false
  STATE.pending = ""
  return true
end

local function selected_from_text(value)
  local selected = {}
  if value == nil or value == "" then return selected end
  for syllable in tostring(value):lower():gmatch("[a-zv]+") do
    if VALID_SYLLABLE[syllable] then
      selected[#selected + 1] = syllable
    end
  end
  return selected
end

local function selected_from_property(context)
  if context == nil or context.get_property == nil then return {} end
  local ok, value = pcall(function()
    return context:get_property("t9_processor_selected")
  end)
  if not ok then return {} end
  return selected_from_text(value)
end

local function digits_from_property(context)
  if context == nil or context.get_property == nil then return "" end
  local ok, value = pcall(function()
    return context:get_property("t9_processor_digits")
  end)
  if ok and value ~= nil and value ~= "" then
    return digit_input(tostring(value))
  end
  return ""
end

local refresh_context

local function composed_input_for_selection(digits, selected)
  digits = digit_input(digits)
  if digits == "" or #selected == 0 then return "" end

  local valid = {}
  local consumed = ""
  for _, syllable in ipairs(selected) do
    local next_consumed = consumed .. t9_digits_for_pinyin(syllable)
    if digits:sub(1, #next_consumed) ~= next_consumed then break end
    valid[#valid + 1] = syllable
    consumed = next_consumed
  end

  if #valid == 0 then return "" end
  local remaining = digits:sub(#consumed + 1)
  if remaining ~= "" then
    return table.concat(valid, "'") .. "'" .. remaining
  end
  return table.concat(valid, "'")
end

local function replace_non_confirmed_input(context, input)
  if context == nil or input == nil or input == "" then return false end

  local cleared = false
  if context.clear ~= nil then
    cleared = pcall(function()
      context:clear()
    end)
  end
  if not cleared and context.clear_non_confirmed_composition ~= nil then
    cleared = pcall(function()
      context:clear_non_confirmed_composition()
    end)
  end
  if not cleared then return false end

  local pushed = false
  if context.push_input ~= nil then
    pushed = pcall(function()
      context:push_input(input)
    end)
  end
  if not pushed then return false end
  if context.set_property ~= nil then
    pcall(function()
      context:set_property("t9_processor_internal_input", input)
    end)
  end
  refresh_context(context)
  return true
end

local function apply_property_selection(context)
  local selected = selected_from_property(context)
  if #selected == 0 then return false end

  local digits = digits_from_property(context)
  if digits == "" then digits = digit_input(context.input) end
  if digits == "" then return false end

  local input = composed_input_for_selection(digits, selected)
  if input == "" then return false end

  STATE.input = digits
  STATE.selected = selected
  STATE.capture = false
  STATE.pending = ""
  return replace_non_confirmed_input(context, input)
end

local function key_repr(key)
  local ok, repr = pcall(function()
    return key:repr()
  end)
  if ok and repr then return repr end
  return ""
end

function refresh_context(context)
  if context == nil or context.refresh_non_confirmed_composition == nil then return end
  pcall(function()
    context:refresh_non_confirmed_composition()
  end)
end

local function is_control_shift_key(key, keycode)
  return key:ctrl() and key:shift() and not key:alt() and key.keycode == keycode
end

local function is_begin_capture(key)
  local repr = key_repr(key)
  return is_control_shift_key(key, 0x5b)
    or repr == "Control+Shift+bracketleft"
    or repr == "Control+Shift+{"
end

local function is_end_capture(key)
  local repr = key_repr(key)
  return is_control_shift_key(key, 0x5d)
    or repr == "Control+Shift+bracketright"
    or repr == "Control+Shift+}"
end

local function is_clear_selection(key)
  local repr = key_repr(key)
  return key:ctrl()
    and key:shift()
    and not key:alt()
    and (key.keycode == 0xff08 or repr == "Control+Shift+BackSpace")
end

local function is_refresh_selection(key)
  local repr = key_repr(key)
  return key:ctrl()
    and key:shift()
    and not key:alt()
    and (key.keycode == 0x20 or repr == "Control+Shift+space")
end

local function capture_letter(key)
  if key:alt() then return nil end
  if key:ctrl() and not key:shift() then return nil end
  local code = key.keycode
  if code >= 0x41 and code <= 0x5a then
    return string.char(code + 0x20)
  end
  if code >= 0x61 and code <= 0x7a then
    return string.char(code)
  end
  return nil
end

local function processor_init(env)
  sync_state_with_input(env.engine.context.input)
end

local function processor_func(key, env)
  if key:release() then return kNoop end

  local context = env.engine.context

  if is_refresh_selection(key) then
    if not apply_property_selection(context) then
      sync_state_with_input(context.input)
      refresh_context(context)
    end
    return kAccepted
  end

  if is_clear_selection(key) then
    STATE.input = digit_input(context.input)
    STATE.selected = {}
    STATE.capture = false
    STATE.pending = ""
    refresh_context(context)
    return kAccepted
  end

  if is_begin_capture(key) then
    sync_state_with_input(context.input)
    STATE.capture = true
    STATE.pending = ""
    return kAccepted
  end

  if not STATE.capture then return kNoop end

  if is_end_capture(key) or key.keycode == 0xff0d or key.keycode == 0x20 then
    local accepted = apply_syllable(context.input, STATE.pending)
    if accepted then
      local input = composed_input_for_selection(STATE.input, STATE.selected)
      if input ~= "" then
        replace_non_confirmed_input(context, input)
      else
        refresh_context(context)
      end
    else
      STATE.capture = false
      STATE.pending = ""
    end
    return kAccepted
  end

  if key.keycode == 0xff1b then
    STATE.capture = false
    STATE.pending = ""
    return kAccepted
  end

  if key.keycode == 0xff08 then
    STATE.pending = STATE.pending:sub(1, math.max(0, #STATE.pending - 1))
    return kAccepted
  end

  local letter = capture_letter(key)
  if letter ~= nil then
    STATE.pending = STATE.pending .. letter
    return kAccepted
  end

  return kAccepted
end

local processor = {
  init = processor_init,
  func = processor_func,
}

t9_processor = processor

return {
  processor = processor,
}
