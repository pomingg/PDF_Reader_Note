# PDF 閱讀筆記

個人用的網頁版 PDF 閱讀器：依專案／資料夾分類文件，之後會加入畫重點、備註，以及以筆記為基礎的 AI 知識庫（問答、統整、MCP 連接器）。

所有資料都存在你自己的電腦上。

## 目前進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| M1 | 專案與資料夾分類、上傳、閱讀器（目錄／縮圖／全文搜尋／縮放／記住頁碼） | ✅ |
| M2 | 畫重點、框選、備註、標籤、筆記側欄 | 規劃中 |
| M3 | Markdown／JSON 匯出 | 規劃中 |
| M4 | 閱讀 AI 輔助（解釋／翻譯／摘要） | 規劃中 |
| M5 | 知識庫問答與統整（附原文引用） | 規劃中 |
| M6 | MCP 連接器（Claude Desktop） | 規劃中 |

## 安裝與執行

需要 [Node.js](https://nodejs.org/) **22.13 以上**（建議安裝 24 LTS）。不需要 Visual Studio 或其他編譯工具。

> 使用 Node 22 時，啟動會出現一行 `ExperimentalWarning: SQLite is an experimental feature`，可以忽略；Node 24 不會出現。

```bash
git clone https://github.com/pomingg/PDF_Reader_Note.git
cd PDF_Reader_Note
npm install
npm run dev
```

打開瀏覽器到 <http://localhost:3000>。

日常使用建議改用正式模式，速度較快：

```bash
npm run build
npm start
```

## 使用方式

- **專案**：左側「專案 ＋」新增，可設定圖示、顏色與說明。系統內建「未分類」專案，不能刪除。
- **資料夾**：在專案或資料夾的「⋯」選單選「新增資料夾」，可以多層巢狀。
- **上傳**：進入專案或資料夾後按「上傳 PDF」，或直接把 PDF 拖進頁面。在「全部文件」上傳的檔案會放進「未分類」。
- **整理**：把文件卡片或資料夾拖到左側樹狀目錄的專案或資料夾上即可移動，也可以用文件的「⋯ → 移動到…」。
- **刪除**：刪除資料夾或專案時，裡面的文件不會被刪掉：刪資料夾會把文件移到專案最上層，刪專案會把文件移到「未分類」。
- **閱讀**：
  - 側欄有目錄、縮圖、搜尋三個分頁
  - `Ctrl/⌘ + F` 開啟全文搜尋，`Enter`／`Shift+Enter` 跳到下一筆或上一筆
  - `Ctrl/⌘ + +`、`Ctrl/⌘ + -` 放大或縮小，`Ctrl/⌘ + 0` 符合寬度
  - 會自動記住讀到的頁數，下次開啟直接回到該頁

## 資料存放與備份

所有資料都在專案內的 `data/` 資料夾（不會進 git）：

```
data/
  app.db      # SQLite 資料庫：專案、資料夾、文件資訊（之後的筆記也在這裡）
  pdfs/       # 上傳的 PDF 檔
```

備份時把整個 `data/` 資料夾複製一份即可。若想把資料放在其他位置（例如 Dropbox 資料夾），啟動前設定環境變數：

```bash
PDF_NOTES_DATA_DIR=/path/to/my-data npm start
```

## 技術架構

- Next.js 16（App Router）＋ React 19 ＋ Tailwind CSS 4
- pdf.js（`pdfjs-dist`）渲染 PDF 與文字層，CMap 與標準字型由 `public/pdfjs/` 提供，`npm install` 時會自動從套件複製過去，確保中文 PDF 正確顯示
- SQLite：使用 Node 內建的 `node:sqlite`，安裝時不需要編譯原生套件

```
app/(library)/       首頁、文件庫（含側邊欄專案樹）
app/read/[id]/       閱讀器
app/api/             projects / folders / documents API
components/reader/   PdfViewer 相關元件（頁面渲染、目錄、縮圖、搜尋）
lib/db.ts            資料庫連線與資料表
lib/library.ts       專案／資料夾／文件的資料存取
```
