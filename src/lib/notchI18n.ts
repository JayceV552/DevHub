export type NotchLanguage = "zh" | "en";

export interface NotchDictionary {
  /** BCP-47 locale used for dates. */
  locale: string;

  tabHome: string;
  tabApps: string;
  tabDevHub: string;
  openDevHub: string;

  notPlaying: string;
  unknownTrack: string;
  prevTrack: string;
  play: string;
  pause: string;
  nextTrack: string;

  today: string;
  allDay: string;
  noEvents: string;
  calendarDenied: string;
  moreEvents: (n: number) => string;
  noApps: string;
  bringToFront: string;
  showInFinder: string;
  quitApp: string;
  forceQuit: string;

  activePorts: string;
  runningProcesses: string;
  keepAwake: string;
  on: string;
  off: string;
}

export const NOTCH_I18N: Record<NotchLanguage, NotchDictionary> = {
  zh: {
    locale: "zh-CN",

    tabHome: "主页",
    tabApps: "状态栏应用",
    tabDevHub: "DevHub 概览",
    openDevHub: "打开 DevHub",

    notPlaying: "未在播放",
    unknownTrack: "未知曲目",
    prevTrack: "上一首",
    play: "播放",
    pause: "暂停",
    nextTrack: "下一首",

    today: "今天",
    allDay: "全天",
    noEvents: "无日程",
    calendarDenied: "未授权访问日历",
    moreEvents: (n) => `还有 ${n} 项`,
    noApps: "暂无状态栏应用",
    bringToFront: "激活窗口",
    showInFinder: "在访达中显示",
    quitApp: "退出",
    forceQuit: "强制退出",

    activePorts: "活跃端口",
    runningProcesses: "运行中脚本",
    keepAwake: "阻止休眠",
    on: "已开启",
    off: "已关闭",
  },
  en: {
    locale: "en-US",

    tabHome: "Home",
    tabApps: "Menu bar apps",
    tabDevHub: "DevHub overview",
    openDevHub: "Open DevHub",

    notPlaying: "Not playing",
    unknownTrack: "Unknown track",
    prevTrack: "Previous",
    play: "Play",
    pause: "Pause",
    nextTrack: "Next",

    today: "Today",
    allDay: "All-day",
    noEvents: "No events",
    calendarDenied: "Calendar access not granted",
    moreEvents: (n) => `${n} more`,
    noApps: "No menu bar apps",
    bringToFront: "Bring to front",
    showInFinder: "Show in Finder",
    quitApp: "Quit",
    forceQuit: "Force quit",

    activePorts: "Active ports",
    runningProcesses: "Running scripts",
    keepAwake: "Keep awake",
    on: "On",
    off: "Off",
  },
};

export function resolveNotchLanguage(value: unknown): NotchLanguage | null {
  return value === "zh" || value === "en" ? value : null;
}
