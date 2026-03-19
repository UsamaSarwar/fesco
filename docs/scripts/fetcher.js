const https = require("https");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");

const BASE_URL = "https://bill.pitc.com.pk/fescobill";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// Minimal cookie jar for requests
const cookieJar = {};

function setCookiesFromHeaders(headers) {
  const raw = headers["set-cookie"];
  if (!raw) return;
  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name && value != null) {
      cookieJar[name.trim()] = value.trim();
    }
  }
}

function getCookieHeader() {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function decodeBuffer(buffer, contentType) {
  if (!contentType) return buffer.toString("utf-8");
  const lowered = contentType.toLowerCase();
  if (lowered.includes("utf-16")) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  return buffer.toString("utf-8");
}

function fetchUrl(url, opts = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...(opts.headers || {}),
    };

    const cookieHeader = getCookieHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const req = https.request(url, { method: opts.method || "GET", headers }, (res) => {
      setCookiesFromHeaders(res.headers);

      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (redirectCount >= 5) {
          return reject(new Error(`Too many redirects: ${url}`));
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        return resolve(fetchUrl(nextUrl, opts, redirectCount + 1));
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const buffer = Buffer.concat(chunks);
        const text = decodeBuffer(buffer, res.headers["content-type"] || "");
        resolve({ status: res.statusCode, headers: res.headers, body: text });
      });
    });

    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function clean(text) {
  if (!text) return "";
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&\w+;/g, " ");
  text = text.replace(/[`‑–—]+/g, " ");
  text = text.replace(/-{2,}/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function extractTokens(html) {
  const tokens = {};
  const patterns = {
    __VIEWSTATE: /id="__VIEWSTATE"\s+value="([^"]*)"/i,
    __VIEWSTATEGENERATOR: /id="__VIEWSTATEGENERATOR"\s+value="([^"]*)"/i,
    __EVENTVALIDATION: /id="__EVENTVALIDATION"\s+value="([^"]*)"/i,
    __RequestVerificationToken: /name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]*)"/i,
  };

  for (const [k, rx] of Object.entries(patterns)) {
    const m = rx.exec(html);
    if (m) tokens[k] = m[1];
  }
  return tokens;
}

function extractGrid(html, headersToFind) {
  const rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = rowRx.exec(html))) {
    rows.push(m[1]);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const upper = clean(row).toUpperCase();
    const found = headersToFind.reduce((count, h) => count + (upper.includes(h) ? 1 : 0), 0);
    if (found >= headersToFind.length - 1 && found > 0) {
      const nextRow = rows[i + 1];
      if (!nextRow) return [];
      return [...nextRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]));
    }
  }
  return [];
}

function extractCharge(label, html) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowRx = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRx.exec(html))) {
    const row = m[1];
    if (new RegExp(escaped, "i").test(row)) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
      for (let i = 0; i < cells.length; i++) {
        if (new RegExp(escaped, "i").test(cells[i])) {
          return clean(cells[i + 1] || "");
        }
      }
    }
  }
  return "";
}

function extractNumbers(text) {
  if (!text) return [];
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

function parseNumber(value) {
  if (value == null) return 0;
  const cleaned = String(value).replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function extractFpaTaxes(html) {
  const m = /<b>\s*GST ON FPA\s*<\/b>[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!m) return {};
  const nums = extractNumbers(m[1]);
  if (!nums.length) return {};

  const total = nums[nums.length - 1];
  const values = nums.slice(0, -1);
  const keys = [
    "gst_on_fpa",
    "ed_on_fpa",
    "further_tax_on_fpa",
    "stax_on_fpa",
    "it_on_fpa",
    "et_on_fpa",
  ];

  const result = {};
  keys.forEach((key, idx) => {
    result[key] = values[idx] || "";
  });
  result.total = total;
  return result;
}

function extractLpSurcharge(html) {
  const m = /<b>\s*L\.P\.SURCHARGE\s*<\/b>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (!m) return {};
  const cell = m[1];
  const ranges = [];
  const rangeRx = /(\d+(?:\.\d+)?)\s*<br\s*\/?>(?:\s*<strong>\s*)(Till|After)\s*([^<]+)<\/strong>\s*<br\s*\/?>([\d\.]+)/gi;
  let r;
  while ((r = rangeRx.exec(cell))) {
    ranges.push({
      label: `${r[2]} ${r[3].trim()}`,
      surcharge: r[1],
      total: r[4],
    });
  }

  if (!ranges.length) return {};
  return {
    lp_surcharge: ranges[0].surcharge,
    after_due_date: ranges[ranges.length - 1].total,
    after_due_date_ranges: ranges,
  };
}

function parseBill(html, refNo) {
  const data = {
    reference_number: refNo,
    consumer_details: {
      consumer_id: "",
      tariff: "",
      load: "",
      old_ac_number: "",
      reference_full: "",
      lock_age: "",
      no_of_acs: "",
      un_bill_age: "",
      name: "",
      father_name: "",
      address: "",
      cnic: "",
    },
    connection_details: {
      connection_date: "",
      connected_load: "",
      curr_mdi: "",
      ed_at: "",
      bill_month: "",
      reading_date: "",
      issue_date: "",
      due_date: "",
      division: "",
      sub_division: "",
      feeder_name: "",
    },
    billing_details: {
      meter_no: "",
      previous_reading: "",
      present_reading: "",
      mf: "",
      units_consumed: "",
      status: "",
    },
    charges_breakdown: {
      fesco_charges: {
        units_consumed: "",
        cost_of_electricity: "",
        meter_rent_fix: "",
        service_rent: "",
        fuel_adj: "",
        fc_surcharge: "",
        total: "",
      },
      govt_charges: {
        electricity_duty: "",
        tv_fee: "",
        gst: "",
        income_tax: "",
        extra_tax: "",
        further_tax: "",
        retailer_stax: "",
        total: "",
      },
      taxes_on_fpa: {
        gst_on_fpa: "",
        ed_on_fpa: "",
        further_tax_on_fpa: "",
        stax_on_fpa: "",
        it_on_fpa: "",
        et_on_fpa: "",
        total: "",
      },
      total_charges: {
        arrear_age: "",
        current_bill: "",
        bill_adj: "",
        installment: "",
        subsidies: "",
        total_fpa: "",
      },
    },
    billing_history: [],
    total_payable: {
      within_due_date: "",
      lp_surcharge: "",
      after_due_date: "",
      after_due_date_ranges: [],
    },
    additional_info: {
      bill_no: "",
      deferred_amount: "",
      outstanding_inst_amount: "",
      progress_gst_paid_fy: "",
      progress_it_paid_fy: "",
    },
  };

  const chargesMatch = /FESCO[\s\S]*?TOTAL\s+CHARGES[\s\S]*?(?=BILL\s+CALCULATION|PAYABLE\s+WITHIN|$)/i.exec(html);
  const chTxt = chargesMatch ? chargesMatch[0] : html;

  const connP = extractGrid(html, ["CONNECTION DATE", "CONNECTED LOAD", "BILL MONTH"]);
  const consP = extractGrid(html, ["CONSUMER ID", "TARIFF", "LOAD"]);
  const refP = extractGrid(html, ["REFERENCE NO", "NO OF ACS"]);
  const meterP = extractGrid(html, ["METER NO", "PREVIOUS", "PRESENT"]);

  Object.assign(data.consumer_details, {
    consumer_id: consP[0] || "",
    tariff: consP[1] || "",
    load: consP[2] || "",
    old_ac_number: consP[3] || "",
    reference_full: refP[0] || "",
    lock_age: refP[1] || "",
    no_of_acs: refP[2] || "",
    un_bill_age: refP[3] || "",
  });

  Object.assign(data.connection_details, {
    connection_date: connP[0] || "",
    connected_load: connP[1] || "",
    curr_mdi: connP[2] || "",
    ed_at: connP[3] || "",
    bill_month: connP[4] || "",
    reading_date: connP[5] || "",
    issue_date: connP[6] || "",
    due_date: connP[7] || (connP[6] || ""),
    division: extractCharge("DIVISION", html),
    sub_division: extractCharge("SUB DIVISION", html),
    feeder_name: extractCharge("FEEDER NAME", html),
  });

  Object.assign(data.billing_details, {
    meter_no: meterP[0] || "",
    previous_reading: meterP[1] || "",
    present_reading: meterP[2] || "",
    mf: meterP[3] || "",
    units_consumed: meterP[4] || "",
    status: meterP[5] || "",
  });

  const nameSection = /NAME\s*(?:&|&amp;)\s*ADDRESS[\s\S]*?(<span>[\s\S]*?<\/p>)/i.exec(html);
  if (nameSection) {
    const spans = [...nameSection[1].matchAll(/<span>([\s\S]*?)<\/span>/gi)].map((m) => clean(m[1]));
    const keep = spans.filter(Boolean);
    if (keep.length) {
      data.consumer_details.name = keep[0];
      if (keep.length > 1) data.consumer_details.father_name = keep[1];
      if (keep.length > 2) data.consumer_details.address = keep.slice(2).join(", ");
    }
  }

  const cnicMatch = /<h4>\s*CNIC\s*<\/h4>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(html);
  if (cnicMatch) {
    data.consumer_details.cnic = clean(cnicMatch[1]);
  } else {
    const cnicInline = /CNIC:\s*(\d+)/i.exec(html);
    if (cnicInline) data.consumer_details.cnic = cnicInline[1];
  }

  const chargeMappings = {
    fesco_charges: [
      ["cost_of_electricity", "COST OF ELECTRICITY"],
      ["meter_rent_fix", "METER RENT"],
      ["service_rent", "SERVICE RENT"],
      ["fuel_adj", "FUEL PRICE ADJUSTMENT"],
      ["fc_surcharge", "F.C SURCHARGE"],
      ["total", "TOTAL"],
    ],
    govt_charges: [
      ["electricity_duty", "ELECTRICITY DUTY"],
      ["tv_fee", "TV FEE"],
      ["gst", "GST"],
      ["income_tax", "INCOME TAX"],
      ["extra_tax", "EXTRA TAX"],
      ["further_tax", "FURTHER TAX"],
      ["retailer_stax", "RETAILER STAX"],
      ["total", "TOTAL"],
    ],
    taxes_on_fpa: [
      ["gst_on_fpa", "GST ON FPA"],
      ["ed_on_fpa", "ED ON FPA"],
      ["further_tax_on_fpa", "FURTHER TAX ON FPA"],
      ["stax_on_fpa", "S.TAX ON FPA"],
      ["it_on_fpa", "IT ON FPA"],
      ["et_on_fpa", "ET ON FPA"],
      ["total", "TOTAL TAXES ON FPA"],
    ],
    total_charges: [
      ["arrear_age", "ARREAR/AGE"],
      ["current_bill", "CURRENT BILL"],
      ["bill_adj", "BILL ADJUSTMENT"],
      ["installment", "INSTALLEMENT"],
      ["subsidies", "SUBSIDIES"],
      ["total_fpa", "TOTAL FPA"],
    ],
  };

  for (const [section, items] of Object.entries(chargeMappings)) {
    for (const [key, label] of items) {
      data.charges_breakdown[section][key] = extractCharge(label, chTxt);
    }
  }

  Object.assign(data.charges_breakdown.taxes_on_fpa, extractFpaTaxes(html));

  if (!data.charges_breakdown.fesco_charges.units_consumed) {
    data.charges_breakdown.fesco_charges.units_consumed = data.billing_details.units_consumed || "";
  }

  {
    const govt = data.charges_breakdown.govt_charges;
    const computed = [
      "electricity_duty",
      "tv_fee",
      "gst",
      "income_tax",
      "extra_tax",
      "further_tax",
      "retailer_stax",
    ].reduce((sum, k) => sum + parseNumber(govt[k]), 0);

    if (computed) {
      const existing = parseNumber(govt.total);
      if (existing === 0 || Math.abs(existing - computed) > 0.01) {
        govt.total = Number.isInteger(computed) ? String(computed) : String(computed.toFixed(2));
      }
    }
  }

  const historyTable = /(<table[^>]*>[\s\S]*?<h4>\s*MONTH\s*<\/h4>[\s\S]*?<\/table>)/i.exec(html);
  if (historyTable) {
    const rows = [...historyTable[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const rowMatch of rows) {
      const rowHtml = rowMatch[1];
      if (/\<h4\>\s*MONTH\s*\<\/h4\>/i.test(rowHtml)) continue;
      const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => clean(c[1]));
      if (cells.length >= 4) {
        const month = cells[0];
        if (/^[A-Za-z]{3}\d{2}$/.test(month)) {
          const units = (cells[1] || "").split(" ").pop() || "";
          data.billing_history.push({
            month,
            units,
            bill: cells[2] || "",
            payment: cells[3] || "",
          });
        }
      }
    }
  }

  data.total_payable.within_due_date = extractCharge("PAYABLE WITHIN DUE DATE", html);
  data.total_payable.after_due_date = extractCharge("PAYABLE AFTER DUE DATE", html);
  data.total_payable.lp_surcharge = extractCharge("L.P.SURCHARGE", html);

  const lpDetails = extractLpSurcharge(html);
  if (Object.keys(lpDetails).length) {
    Object.assign(data.total_payable, lpDetails);
  }

  return data;
}

async function fetchBill(refNo, opts = {}) {
  // if opts.saveOutput = true, it will save HTML and JSON to output/ (same as Python)
  const { saveOutput = true } = opts;
  cookieJar.__proto__ = null; // reset cookie jar between calls
  Object.keys(cookieJar).forEach((k) => delete cookieJar[k]);

  // 1) Load initial page to capture cookies + tokens
  const initial = await fetchUrl(BASE_URL);
  const tokens = extractTokens(initial.body);
  if (!tokens || Object.keys(tokens).length === 0) {
    throw new Error("Failed to extract security tokens.");
  }

  // 2) POST to fetch bill
  const form = new URLSearchParams({
    __VIEWSTATE: tokens.__VIEWSTATE || "",
    __VIEWSTATEGENERATOR: tokens.__VIEWSTATEGENERATOR || "",
    __EVENTVALIDATION: tokens.__EVENTVALIDATION || "",
    __RequestVerificationToken: tokens.__RequestVerificationToken || "",
    searchTextBox: refNo,
    btnSearch: "Search",
  });

  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  if (tokens.__RequestVerificationToken) {
    headers["RequestVerificationToken"] = tokens.__RequestVerificationToken;
  }

  const post = await fetchUrl(BASE_URL, { method: "POST", headers, body: form.toString() });
  const billHtml = post.body;

  const data = parseBill(billHtml, refNo);

  if (saveOutput) {
    const outDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(path.join(outDir, `fesco_${refNo}.html`), billHtml, { encoding: "utf-8" });
    fs.writeFileSync(path.join(outDir, `fesco_${refNo}.json`), JSON.stringify(data, null, 2), { encoding: "utf-8" });
  }

  return { data, html: billHtml };
}

module.exports = { fetchBill };

module.exports = { fetchBill };
