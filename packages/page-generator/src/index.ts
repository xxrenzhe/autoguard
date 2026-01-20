// 主入口
export { scrapePage, scrapePageSimple, type ScrapeConfig, type ScrapeResult, type AssetInfo } from './scraper';
export { generateSafePage, type SafePageType, type GenerateConfig, type GenerateResult } from './ai';
export {
  getPageDir,
  getPageHtmlPath,
  getAssetsDir,
  ensureDir,
  savePageHtml,
  readPageHtml,
  pageExists,
  deletePage,
  listSubdomains,
  getPageInfo,
  processHtmlAssetPaths,
  savePageWithProcessedPaths,
} from './storage';
