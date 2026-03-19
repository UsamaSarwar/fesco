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

function renderJson(data) {
  const summary = document.getElementById("summary");
  const charges = document.getElementById("charges");
  const history = document.getElementById("history");
  const raw = document.getElementById("raw");

  summary.innerHTML = "";
  charges.innerHTML = "";
  history.innerHTML = "";
  raw.textContent = JSON.stringify(data, null, 2);

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

function fetchBill(ref) {
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

  const apiUrl = `/api/bill?ref=${encodeURIComponent(ref)}`;
  const fallbackJson = `./data/fesco_${encodeURIComponent(ref)}.json`;

  // First attempt: live server endpoint (local server, not GitHub Pages)
  return fetch(apiUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    })
    .then((result) => {
      document.getElementById("viewer").style.display = "block";
      const data = result.data || result;
      data._html = result.html || "";
      renderJson(data);
    })
    .catch(() => {
      // Fallback: load a pre-generated JSON file (works on GitHub Pages)
      return fetch(fallbackJson)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load ${fallbackJson} (HTTP ${res.status})`);
          return res.json();
        })
        .then((data) => {
          document.getElementById("viewer").style.display = "block";
          renderJson(data);
        })
        .catch((err) => {
          alert("Failed to load bill: " + err.message);
        });
    });
}

window.addEventListener("DOMContentLoaded", () => {
  const refInput = document.getElementById("refInput");
  const fetchBtn = document.getElementById("fetchBtn");

  const setLoading = (isLoading) => {
    if (isLoading) {
      fetchBtn.classList.add("morph");
      fetchBtn.disabled = true;
      fetchBtn.textContent = "Loading…";
    } else {
      fetchBtn.classList.remove("morph");
      fetchBtn.disabled = !refInput.value.trim();
      fetchBtn.textContent = "Fetch";
    }
  };

  refInput.addEventListener("input", () => {
    fetchBtn.disabled = !refInput.value.trim();
  });

  fetchBtn.addEventListener("click", () => {
    const ref = refInput.value.trim();
    if (!ref) return;
    setLoading(true);
    fetchBill(ref).finally(() => setLoading(false));
  });
});
