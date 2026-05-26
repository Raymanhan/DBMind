import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ru from './locales/ru.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import fr from './locales/fr.json';
import de from './locales/de.json';

export const LANGUAGES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export function initI18n(language: string) {
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, 'zh-CN': { translation: zhCN }, 'zh-TW': { translation: zhTW }, ru: { translation: ru }, ja: { translation: ja }, ko: { translation: ko }, fr: { translation: fr }, de: { translation: de } },
    lng: language,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnObjects: false,
  });
  return i18n;
}
