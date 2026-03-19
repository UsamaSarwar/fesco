function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (!child) return;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  });
  return node;
}

function titleize(key) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bId\b/, "ID")
    .replace(/\bUrl\b/, "URL");
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function renderKeyValueTable(title, obj) {
  const table = el("table");
  const thead = el("thead", {}, [el("tr", {}, [el("th", { text: title }), el("th", { text: "Value" })])]);
  const tbody = el("tbody");

  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: titleize(k) }),
        el("td", { text: formatValue(v) }),
      ])
    );
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function parseBillHtml(htmlString, ref) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, "text/html");

  const cleanText = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/\s+/g, " ")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[`‑–—]+/g, " ")
      .replace(/-{2,}/g, " ")
      .trim();
  };

  const extractGrid = (headers) => {
    const rows = Array.from(doc.querySelectorAll("tr"));
    for (let i = 0; i < rows.length - 1; i++) {
      const text = cleanText(rows[i].textContent).toUpperCase();
      const found = headers.filter((h) => text.includes(h)).length;
      if (found >= headers.length - 1 && found > 0) {
        return Array.from(rows[i + 1].querySelectorAll("td")).map((td) => cleanText(td.textContent));
      }
    }
    return [];
  };

  const extractCharge = (label) => {
    const rs = Array.from(doc.querySelectorAll("tr"));
    for (const row of rs) {
      const text = cleanText(row.textContent);
      if (text.toUpperCase().includes(label.toUpperCase())) {
        const tds = Array.from(row.querySelectorAll("td")).map((td) => cleanText(td.textContent));
        for (let i = 0; i < tds.length; i++) {
          if (tds[i].toUpperCase().includes(label.toUpperCase())) {
            return tds[i + 1] || "";
          }
        }
      }
    }
    return "";
  };

  const data = {
    reference_number: ref,
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
    _html: htmlString,
  };

  const connP = extractGrid(["CONNECTION DATE", "CONNECTED LOAD", "BILL MONTH"]);
  const consP = extractGrid(["CONSUMER ID", "TARIFF", "LOAD"]);
  const refP = extractGrid(["REFERENCE NO", "NO OF ACS"]);
  const meterP = extractGrid(["METER NO", "PREVIOUS", "PRESENT"]);

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
    division: extractCharge("DIVISION"),
    sub_division: extractCharge("SUB DIVISION"),
    feeder_name: extractCharge("FEEDER NAME"),
  });

  Object.assign(data.billing_details, {
    meter_no: meterP[0] || "",
    previous_reading: meterP[1] || "",
    present_reading: meterP[2] || "",
    mf: meterP[3] || "",
    units_consumed: meterP[4] || "",
    status: meterP[5] || "",
  });

  const nameSection = /NAME\s*(?:&|&amp;)\s*ADDRESS[\s\S]*?(<span>[\s\S]*?<\/p>)/i.exec(htmlString);
  if (nameSection) {
    const spans = [...nameSection[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((m) => cleanText(m[1])).filter(Boolean);
    if (spans.length) {
      data.consumer_details.name = spans[0] || "";
      data.consumer_details.father_name = spans[1] || "";
      data.consumer_details.address = spans.slice(2).join(", ");
    }
  }

  const cnicMatch = /<h4>\s*CNIC\s*<\/h4>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(htmlString);
  if (cnicMatch) {
    data.consumer_details.cnic = cleanText(cnicMatch[1]);
  } else {
    data.consumer_details.cnic = extractCharge("CNIC") || "";
  }

  // Extract charges from HTML grid sections
  const chargesSection = htmlString; // fallback to raw
  data.charges_breakdown.fesco_charges.units_consumed = extractCharge("UNITS CONSUMED") || "";
  data.charges_breakdown.fesco_charges.cost_of_electricity = extractCharge("COST OF ELECTRICITY") || "";
  data.charges_breakdown.fesco_charges.meter_rent_fix = extractCharge("METER RENT") || "";
  data.charges_breakdown.fesco_charges.fuel_adj = extractCharge("FUEL PRICE ADJUSTMENT") || "";
  data.charges_breakdown.govt_charges.gst = extractCharge("GST") || "";

  // billing history
  const historyTable = Array.from(doc.querySelectorAll("table")).find((t) => t.textContent.includes("MONTH") && t.textContent.includes("UNITS"));
  if (historyTable) {
    const rows = Array.from(historyTable.querySelectorAll("tr"));
    rows.slice(1).forEach((tr) => {
      const cols = Array.from(tr.querySelectorAll("td")).map((c) => cleanText(c.textContent));
      if (cols.length >= 4) {
        const month = cols[0];
        if (/^[A-Za-z]{3}\d{2}$/.test(month)) {
          data.billing_history.push({ month, units: cols[1], bill: cols[2], payment: cols[3] });
        }
      }
    });
  }

  data.total_payable.within_due_date = extractCharge("PAYABLE WITHIN DUE DATE") || "";
  data.total_payable.after_due_date = extractCharge("PAYABLE AFTER DUE DATE") || "";
  data.total_payable.lp_surcharge = extractCharge("L.P.SURCHARGE") || "";

  return data;
}


function renderCharges(breakdown) {
  const container = el("div", { class: "grid" });
  Object.entries(breakdown).forEach(([section, values]) => {
    const card = el("div", { class: "card" }, [el("h3", { text: section.replace(/_/g, " ") })]);
    card.appendChild(renderKeyValueTable("", values));
    container.appendChild(card);
  });
  return container;
}

function renderHistory(history) {
  const table = el("table");
  const thead = el("thead", {}, [
    el("tr", {}, ["month", "units", "bill", "payment"].map((h) => el("th", { text: h })) ),
  ]);
  const tbody = el("tbody");
  history.forEach((row) => {
    tbody.appendChild(
      el("tr", {}, [
        el("td", { text: row.month }),
        el("td", { text: row.units }),
        el("td", { text: row.bill }),
        el("td", { text: row.payment }),
      ])
    );
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}


function renderDashboard(data) {
  const dashboard = document.getElementById("dashboard");
  if (!dashboard) return;

  const totalDue = data.total_payable?.within_due_date || "N/A";
  const dueDate = data.connection_details?.due_date || "N/A";
  const billMonth = data.connection_details?.bill_month || "N/A";
  const name = data.consumer_details?.name || "N/A";
  const ref = data.reference_number || "N/A";

  dashboard.innerHTML = "";

  const header = el("div", { class: "dash-header" }, [
    el("div", { class: "dash-hero" }, [
      el("h3", { text: "Total payable" }),
      el("div", { class: "dash-amount", text: totalDue }),
      el("p", { class: "dash-sub", text: `Due ${dueDate} • ${billMonth}` }),
    ]),
    el("div", { class: "dash-meta" }, [
      el("div", { class: "dash-meta-item" }, [
        el("div", { class: "dash-meta-label", text: "Reference" }),
        el("div", { class: "dash-meta-value", text: ref }),
      ]),
      el("div", { class: "dash-meta-item" }, [
        el("div", { class: "dash-meta-label", text: "Name" }),
        el("div", { class: "dash-meta-value", text: name }),
      ]),
    ]),
  ]);

  dashboard.appendChild(header);
}

function renderJson(data) {
  const summary = document.getElementById("summary");
  const charges = document.getElementById("charges");
  const history = document.getElementById("history");
  const raw = document.getElementById("raw");
  const htmlFrame = document.getElementById("htmlFrame");

  summary.innerHTML = "";
  charges.innerHTML = "";
  history.innerHTML = "";
  raw.textContent = JSON.stringify(data, null, 2);

  renderDashboard(data);

  summary.appendChild(renderKeyValueTable("Consumer", data.consumer_details || {}));
  summary.appendChild(renderKeyValueTable("Connection", data.connection_details || {}));
  summary.appendChild(renderKeyValueTable("Meter", data.billing_details || {}));
  summary.appendChild(renderKeyValueTable("Total Payable", data.total_payable || {}));

  if (data.charges_breakdown) {
    charges.appendChild(renderCharges(data.charges_breakdown));
  }

  if (Array.isArray(data.billing_history) && data.billing_history.length) {
    history.appendChild(renderHistory(data.billing_history));
  } else {
    history.appendChild(el("p", { text: "No billing history found." }));
  }

  if (htmlFrame) {
    htmlFrame.srcdoc = data._html || "<p>No HTML available</p>";
  }
}

function isValidRef(ref) {
  return /^\d{14}$/.test(ref);
}

async function fetchBill(ref) {
  const viewer = document.getElementById("viewer");
  const raw = document.getElementById("raw");
  const summary = document.getElementById("summary");
  const charges = document.getElementById("charges");
  const history = document.getElementById("history");
  const htmlFrame = document.getElementById("htmlFrame");

  viewer.style.display = "none";
  raw.textContent = "";
  summary.innerHTML = "";
  charges.innerHTML = "";
  history.innerHTML = "";
  if (htmlFrame) htmlFrame.srcdoc = "";

  try {
    const billUrl = `https://bill.pitc.com.pk/fescobill/general?refno=${encodeURIComponent(ref)}`;
    const response = await fetch(billUrl, { method: "GET" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const data = parseBillHtml(html, ref);
    data._html = html;

    document.getElementById("viewer").style.display = "block";
    renderJson(data);
  } catch (err) {
    const message = err?.message || "Unknown error";
    console.error("Failed to load bill", { message, err });
    alert(`Failed to load bill: ${message}`);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const refInput = document.getElementById("refInput");
  const fetchBtn = document.getElementById("fetchBtn");

  const syncButtonState = () => {
    fetchBtn.disabled = !isValidRef(refInput.value.trim());
  };

  const setLoading = (isLoading) => {
    if (isLoading) {
      fetchBtn.classList.add("morph");
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Loading…";
    } else {
      fetchBtn.classList.remove("morph");
      syncButtonState();
      fetchBtn.textContent = "Fetch";
    }
  };

  refInput.addEventListener("input", () => {
    syncButtonState();
  });

  fetchBtn.addEventListener("click", () => {
    const ref = refInput.value.trim();
    if (!isValidRef(ref)) {
      alert("Enter a valid 14-digit reference number.");
      return;
    }
    setLoading(true);
    fetchBill(ref).finally(() => setLoading(false));
  });

  syncButtonState();
});
