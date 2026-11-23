/**
 * ============================================================================
 * كود Google Apps Script المحدث لربط موقع القضية (case-site) بـ Google Sheets
 * ============================================================================
 * يدعم:
 * 1. روابط الصور والفيديوهات المباشرة من الإنترنت في أي خلية.
 * 2. معادلات =IMAGE("https://...") إذا استخدمها المستخدم داخل الشيت.
 * 3. روابط يوتيوب (YouTube / Shorts) وروابط Google Drive.
 * ============================================================================
 */

const SCRIPT_SECRET = "";
const DRIVE_FOLDER_NAME = "Case_Site_Media_Uploads";

function authorizeDriveAndSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsInitialized(ss);
  const folder = getOrCreateDriveFolder();
  Logger.log("✅ تم تفعيل صلاحيات الشيت ومجلد Google Drive بنجاح: " + folder.getUrl());
}

function doGet(e) {
  return handleRequest(e, "GET");
}

function doPost(e) {
  return handleRequest(e, "POST");
}

function handleRequest(e, method) {
  const lock = LockService.getScriptLock();
  lock.tryLock(25000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ensureSheetsInitialized(ss);
    const caseSheet = sheets.caseSheet;
    const mediaSheet = sheets.mediaSheet;

    let payload = {};
    if (method === "POST" && e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    if (SCRIPT_SECRET && payload.secret !== SCRIPT_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized script secret" });
    }

    const action = payload.action || "getAll";

    if (action === "getDriveFile") {
      const fileId = String(payload.fileId || "").trim();
      if (!fileId) {
        return jsonResponse({ ok: false, error: "Missing fileId" });
      }
      try {
        const file = DriveApp.getFileById(fileId);
        const blob = file.getBlob();
        return jsonResponse({
          ok: true,
          mimeType: blob.getContentType() || "image/jpeg",
          base64Data: Utilities.base64Encode(blob.getBytes()),
        });
      } catch (err) {
        return jsonResponse({ ok: false, error: String(err) });
      }
    }

    if (action === "getAll") {
      const caseInfo = readCaseInfoFromSheet(caseSheet);
      const media = readMediaFromSheet(mediaSheet);
      return jsonResponse({ ok: true, caseInfo: caseInfo, media: media });
    }

    if (action === "updateCase") {
      const now = new Date().toISOString();
      const title = String(payload.title || "");
      const description = String(payload.description || "");
      const contactName = String(payload.contactName || "");
      const contactPhone = String(payload.contactPhone || "");
      const contactPhone2 = String(payload.contactPhone2 || "");

      caseSheet.getRange(2, 1, 1, 6).setValues([
        [title, description, contactName, contactPhone, contactPhone2, now],
      ]);
      SpreadsheetApp.flush();

      return jsonResponse({
        ok: true,
        caseInfo: {
          id: "singleton",
          title: title,
          description: description,
          contactName: contactName,
          contactPhone: contactPhone,
          contactPhone2: contactPhone2,
          updatedAt: now,
        },
      });
    }

    if (action === "addMedia") {
      const id = String(payload.id || Utilities.getUuid());
      const title = String(payload.title || "مرفق توثيقي");
      const caption = String(payload.caption || "");
      const kind = payload.kind === "video" ? "video" : "image";
      const mimeType = String(
        payload.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg")
      );
      const sizeBytes = Number(payload.sizeBytes || 0);
      const createdAt = String(payload.createdAt || new Date().toISOString());
      const storedName = String(
        payload.storedName || id + (kind === "video" ? ".mp4" : ".jpg")
      );

      const localUrl = "/api/media?file=" + encodeURIComponent(storedName);
      let fileUrl = String(payload.url || localUrl);
      let driveFileId = "";

      if (payload.base64Data) {
        try {
          const folder = getOrCreateDriveFolder();
          const decoded = Utilities.base64Decode(payload.base64Data);
          const blob = Utilities.newBlob(decoded, mimeType, storedName);
          const driveFile = folder.createFile(blob);
          driveFile.setSharing(
            DriveApp.Access.ANYONE_WITH_LINK,
            DriveApp.Permission.VIEW
          );
          driveFileId = driveFile.getId();

          if (!payload.url || String(payload.url).indexOf("/api/media?file=") === -1) {
            fileUrl = "https://drive.google.com/file/d/" + driveFileId + "/view";
          }
        } catch (driveErr) {
          fileUrl = payload.url || localUrl;
        }
      }

      mediaSheet.appendRow([
        id,
        title,
        caption,
        kind,
        fileUrl,
        mimeType,
        sizeBytes,
        driveFileId,
        createdAt,
      ]);
      SpreadsheetApp.flush();

      return jsonResponse({
        ok: true,
        media: {
          id: id,
          title: title,
          caption: caption,
          kind: kind,
          url: fileUrl,
          mimeType: mimeType,
          sizeBytes: sizeBytes,
          driveFileId: driveFileId,
          storedName: storedName,
          createdAt: createdAt,
        },
      });
    }

    if (action === "deleteMedia") {
      const targetId = String(payload.id || "");
      const data = mediaSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === targetId || ("sheet-row-" + (i + 1)) === targetId) {
          const driveFileId = String(data[i][7] || "");
          if (driveFileId) {
            try {
              DriveApp.getFileById(driveFileId).setTrashed(true);
            } catch (err) {}
          }
          mediaSheet.deleteRow(i + 1);
          SpreadsheetApp.flush();
          break;
        }
      }
      return jsonResponse({ ok: true, deletedId: targetId });
    }

    return jsonResponse({ ok: false, error: "Unknown action: " + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function ensureSheetsInitialized(ss) {
  let caseSheet = ss.getSheetByName("CaseInfo");
  if (!caseSheet) {
    caseSheet = ss.insertSheet("CaseInfo");
    caseSheet.appendRow([
      "title",
      "description",
      "contactName",
      "contactPhone",
      "contactPhone2",
      "updatedAt",
    ]);
    caseSheet.appendRow([
      "توضيح تفاصيل القضية والمرفقات المصورة",
      "تحتوي هذه الصفحة على شرح كامل لتفاصيل القضية مع جميع الصور ومقاطع الفيديو التوضيحية المرتبطة بها.",
      "",
      "",
      "",
      new Date().toISOString(),
    ]);
    caseSheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  }

  let mediaSheet = ss.getSheetByName("Media");
  if (!mediaSheet) {
    mediaSheet = ss.insertSheet("Media");
    mediaSheet.appendRow([
      "id",
      "title",
      "caption",
      "kind",
      "url",
      "mimeType",
      "sizeBytes",
      "driveFileId",
      "createdAt",
    ]);
    mediaSheet.getRange(1, 1, 1, 9).setFontWeight("bold");
  }

  return { caseSheet: caseSheet, mediaSheet: mediaSheet };
}

function readCaseInfoFromSheet(caseSheet) {
  const rows = caseSheet.getDataRange().getValues();
  if (rows.length < 2) {
    return {
      id: "singleton",
      title: "توضيح تفاصيل القضية والمرفقات المصورة",
      description: "",
      contactName: "",
      contactPhone: "",
      contactPhone2: "",
      updatedAt: new Date().toISOString(),
    };
  }
  const r = rows[1];
  return {
    id: "singleton",
    title: String(r[0] || ""),
    description: String(r[1] || ""),
    contactName: String(r[2] || ""),
    contactPhone: String(r[3] || ""),
    contactPhone2: String(r[4] || ""),
    updatedAt: String(r[5] || new Date().toISOString()),
  };
}

// استخراج الرابط حتى لو كان مكتوباً داخل معادلة =IMAGE("https://...")
function extractUrlFromCellOrFormula(val, formula) {
  const f = String(formula || "").trim();
  if (f) {
    const match = f.match(/IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (match && match[1]) return match[1].trim();
    const urlMatch = f.match(/https?:\/\/[^\s"')]+/i);
    if (urlMatch && urlMatch[0]) return urlMatch[0].trim();
  }
  const v = String(val || "").trim();
  if (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("/api/media") ||
    v.startsWith("data:image/")
  ) {
    return v;
  }
  return "";
}

function readMediaFromSheet(mediaSheet) {
  const range = mediaSheet.getDataRange();
  const rows = range.getValues();
  const formulas = range.getFormulas();

  if (rows.length < 2) return [];
  const items = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const fRow = formulas[i] || [];

    let id = String(r[0] || "").trim();
    let title = String(r[1] || "").trim();
    let caption = String(r[2] || "").trim();
    let kindRaw = String(r[3] || "").toLowerCase().trim();
    let url = extractUrlFromCellOrFormula(r[4], fRow[4]);
    let mimeType = String(r[5] || "").trim();
    let sizeBytes = Number(r[6] || 0);
    let driveFileId = String(r[7] || "").trim();
    let createdAt = String(r[8] || "").trim();

    // إذا وضع المستخدم الرابط أو معادلة =IMAGE() في أي عمود آخر (مثل العمود A أو B أو C)
    if (!url) {
      for (let col = 0; col < r.length; col++) {
        const candidate = extractUrlFromCellOrFormula(r[col], fRow[col]);
        if (candidate) {
          url = candidate;
          break;
        }
      }
    }

    if (!title && id && !id.startsWith("http") && id.length < 100) {
      title = id;
      id = "sheet-row-" + (i + 1);
    }

    if (!id || id.startsWith("http")) {
      id = "sheet-row-" + (i + 1);
    }

    let kind = "image";
    if (
      kindRaw === "video" ||
      kindRaw === "فيديو" ||
      url.indexOf("youtube.com/") !== -1 ||
      url.indexOf("youtu.be/") !== -1 ||
      /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url)
    ) {
      kind = "video";
    }

    if (!url && !driveFileId) continue;

    items.push({
      id: id,
      title: title || "صورة مرفقة",
      caption: caption || null,
      kind: kind,
      url: url,
      mimeType: mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"),
      sizeBytes: isNaN(sizeBytes) ? 0 : sizeBytes,
      driveFileId: driveFileId,
      createdAt: createdAt || new Date().toISOString(),
    });
  }

  return items.reverse();
}

function getOrCreateDriveFolder() {
  const folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  const folder = DriveApp.createFolder(DRIVE_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
