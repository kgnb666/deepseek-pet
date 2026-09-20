/**
 * 余额分档心情（纯函数）：对标 dsh-pet「余额分档动画（6 种）」。
 * 按当前余额分 6 档，跨档时桌宠切换姿势 + 台词。
 */

export const TIERS = [
  {
    key: 'debt',
    min: -Infinity,
    label: '欠费了',
    pose: 'char_angry',
    lines: ['呜哇，余额是负的了！<br>快去充值啦主人 🆘', '欠费预警！<br>再不充值我要饿肚子了 😭'],
  },
  {
    key: 'broke',
    min: 0,
    label: '弹尽粮绝',
    pose: 'char_sleep',
    lines: ['余额不到 ¥10 了…<br>我省着点花 💸', '快见底啦…<br>主人快想想办法～'],
  },
  {
    key: 'tight',
    min: 10,
    label: '细水长流',
    pose: 'char_main',
    lines: ['余额还行，<br>低价时段再跑任务更划算～', '安心，还有余额。<br>但别大手大脚哦～'],
  },
  {
    key: 'cozy',
    min: 50,
    label: '小有富余',
    pose: 'char_happy',
    lines: ['余额充足！<br>可以放心跑了 🐳', '嘿嘿，余粮满满～'],
  },
  {
    key: 'rich',
    min: 200,
    label: '腰缠万贯',
    pose: 'char_work',
    lines: ['余额雄厚！<br>大任务尽管来吧 💪', '主人好阔气！<br>今晚加个鸡腿？🍗'],
  },
  {
    key: 'whale',
    min: 1000,
    label: '鲸鱼大户',
    pose: 'char_shy',
    lines: ['哇！余额上千了！<br>主人是隐藏大佬吧 🐋✨', '千亿富豪（并没有）<br>但真的好有钱！💰💰'],
  },
];

/** @returns {{key:string,label:string,pose:string,lines:string[],index:number}} */
export function tierFor(total) {
  const v = Number(total);
  const safe = Number.isFinite(v) ? v : 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (safe >= TIERS[i].min) return { ...TIERS[i], index: i };
  }
  return { ...TIERS[0], index: 0 };
}
