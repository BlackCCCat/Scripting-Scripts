export type T9PinyinOption = {
  label: string;
  digits: string;
  selected: string[];
};

export type T9FilterState = {
  digits: string;
  selected: string[];
};

const T9_LETTER_TO_DIGIT: Record<string, string> = {
  a: "2",
  b: "2",
  c: "2",
  d: "3",
  e: "3",
  f: "3",
  g: "4",
  h: "4",
  i: "4",
  j: "5",
  k: "5",
  l: "5",
  m: "6",
  n: "6",
  o: "6",
  p: "7",
  q: "7",
  r: "7",
  s: "7",
  t: "8",
  u: "8",
  v: "8",
  w: "9",
  x: "9",
  y: "9",
  z: "9",
};

const PINYIN_SYLLABLES = `
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
`.trim().split(/\s+/);

const T9_SYLLABLE_OPTIONS = Array.from(new Set(PINYIN_SYLLABLES)).map((
  label,
  index,
) => ({
  label,
  digits: t9DigitsForPinyin(label),
  index,
}));

export function t9DigitsForPinyin(text: string): string {
  let digits = "";
  for (const ch of text.toLowerCase()) {
    digits += T9_LETTER_TO_DIGIT[ch] ?? "";
  }
  return digits;
}

export function t9DigitsForInput(text: string): string {
  let digits = "";
  for (const ch of text.toLowerCase()) {
    if (/^[1-9]$/.test(ch)) digits += ch;
    else digits += T9_LETTER_TO_DIGIT[ch] ?? "";
  }
  return digits;
}

export function t9SelectedDigitPrefix(selected: string[]) {
  return selected.map(t9DigitsForPinyin).join("");
}

function t9FilterCursor(filter: T9FilterState) {
  const selected = filter.selected.filter(Boolean);
  const consumed = t9SelectedDigitPrefix(selected);
  if (consumed.length < filter.digits.length) {
    return {
      replaceIndex: selected.length,
      tail: filter.digits.slice(consumed.length),
    };
  }
  if (selected.length > 0) {
    const prefixSelected = selected.slice(0, -1);
    const prefixDigits = t9SelectedDigitPrefix(prefixSelected);
    return {
      replaceIndex: selected.length - 1,
      tail: filter.digits.slice(prefixDigits.length),
    };
  }
  return {
    replaceIndex: 0,
    tail: filter.digits,
  };
}

export function t9PinyinOptionsForFilter(
  filter: T9FilterState,
  limit: number,
): T9PinyinOption[] {
  const { replaceIndex, tail } = t9FilterCursor(filter);
  if (!tail) return [];
  const options = t9PinyinOptionsForTail(filter, replaceIndex, tail);
  if (options.length > 0 || replaceIndex === 0) {
    return options.slice(0, limit);
  }
  const prefixSelected = filter.selected.filter(Boolean).slice(0, -1);
  const prefixDigits = t9SelectedDigitPrefix(prefixSelected);
  return t9PinyinOptionsForTail(
    filter,
    prefixSelected.length,
    filter.digits.slice(prefixDigits.length),
  ).slice(0, limit);
}

function t9PinyinOptionsForTail(
  filter: T9FilterState,
  replaceIndex: number,
  tail: string,
): T9PinyinOption[] {
  const seen = new Set<string>();
  return T9_SYLLABLE_OPTIONS
    .filter((option) => {
      if (!option.digits || !tail.startsWith(option.digits)) return false;
      if (seen.has(option.label)) return false;
      seen.add(option.label);
      return true;
    })
    .map((option) => {
      const selected = filter.selected.slice(0, replaceIndex);
      selected[replaceIndex] = option.label;
      return {
        option: {
          label: option.label,
          digits: filter.digits,
          selected,
        },
        index: option.index,
      };
    })
    .sort((a, b) =>
      b.option.label.length - a.option.label.length ||
      a.index - b.index
    )
    .map(({ option }) => option);
}
