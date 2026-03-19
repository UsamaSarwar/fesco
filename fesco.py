#!/usr/bin/env python3
import sys
import re
import urllib.request
import urllib.parse
import http.cookiejar
import logging
import json
import argparse
import os

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger("FescoFetcher")

class FescoFetcher:
    """A tool to fetch FESCO electricity bills and parse them into data objects."""
    
    BASE_URL = "https://bill.pitc.com.pk/fescobill"
    USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

    def __init__(self):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        self.opener.addheaders = [('User-Agent', self.USER_AGENT)]

    def _clean(self, text):
        """Sanitizes extracted HTML text by removing tags and extra whitespace."""
        if not text:
            return ""
        text = re.sub(r'<[^>]+>', ' ', text)  # Strip HTML
        text = re.sub(r'&\w+;', ' ', text)    # Strip HTML entities
        # Remove common decorative separators and backticks left over from HTML formatting
        text = re.sub(r'[`‑–—]+', ' ', text)
        text = re.sub(r'-{2,}', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()  # Squeeze whitespace
        return text

    def _get_tokens(self, html):
        """Extracts ASP.NET anti-forgery tokens from HTML."""
        tokens = {}
        patterns = {
            '__VIEWSTATE': r'id="__VIEWSTATE" value="(.*?)"',
            '__VIEWSTATEGENERATOR': r'id="__VIEWSTATEGENERATOR" value="(.*?)"',
            '__EVENTVALIDATION': r'id="__EVENTVALIDATION" value="(.*?)"',
            '__RequestVerificationToken': r'name="__RequestVerificationToken" type="hidden" value="(.*?)"'
        }
        for key, pattern in patterns.items():
            match = re.search(pattern, html)
            if match:
                tokens[key] = match.group(1)
        return tokens

    def fetch_bill(self, reference_number, output_json=False):
        """Fetches the bill content and returns parsed data."""
        try:
            # 1. Access the search page to get session cookies and tokens
            if not output_json:
                logger.info(f"[*] Connecting to {self.BASE_URL}...")
            
            with self.opener.open(self.BASE_URL) as response:
                initial_html = response.read().decode('utf-8')
            
            tokens = self._get_tokens(initial_html)
            if not tokens:
                logger.error("[!] Failed to extract security tokens.")
                return None

            # 2. Submit the POST request
            if not output_json:
                logger.info(f"[*] Fetching bill for {reference_number}...")
            
            post_data = {
                "__VIEWSTATE": tokens.get('__VIEWSTATE', ''),
                "__VIEWSTATEGENERATOR": tokens.get('__VIEWSTATEGENERATOR', ''),
                "__EVENTVALIDATION": tokens.get('__EVENTVALIDATION', ''),
                "__RequestVerificationToken": tokens.get('__RequestVerificationToken', ''),
                "searchTextBox": reference_number,
                "btnSearch": "Search"
            }
            encoded_data = urllib.parse.urlencode(post_data).encode('utf-8')
            
            request = urllib.request.Request(self.BASE_URL, data=encoded_data, method='POST')
            if '__RequestVerificationToken' in tokens:
                request.add_header('RequestVerificationToken', tokens['__RequestVerificationToken'])
            
            with self.opener.open(request) as response:
                content = response.read()
                content_type = response.info().get('Content-Type', '').lower()
                encoding = 'utf-16' if 'utf-16' in content_type else 'utf-8'
                bill_html = content.decode(encoding, errors='ignore')

            # 3. Make HTML portable (resolve relative paths and inline CSS)
            bill_html = self._make_html_portable(bill_html)

            # 4. Parse Data
            data = self._parse_bill(bill_html, reference_number)
            
            # 4. Handle Output
            if output_json:
                print(json.dumps(data, indent=2))
            else:
                # Ensure output directory exists
                os.makedirs("output", exist_ok=True)

                # Save HTML
                html_filename = os.path.join("output", f"fesco_{reference_number}.html")
                with open(html_filename, "w", encoding="utf-8") as f:
                    f.write(bill_html)
                logger.info(f"[+] Bill HTML saved to {html_filename}")

                # Save JSON
                json_filename = os.path.join("output", f"fesco_{reference_number}.json")
                with open(json_filename, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                logger.info(f"[+] Bill details saved to {json_filename}")

                logger.info(f"[i] Consumer: {data['consumer_details'].get('name')}")
                logger.info(f"[i] Amount: {data['total_payable'].get('within_due_date')}")
                logger.info(f"[i] Due Date: {data['connection_details'].get('due_date')}")

            return data

        except Exception as e:
            if not output_json:
                logger.error(f"[!] Error: {e}")
            else:
                print(json.dumps({"error": str(e)}))
            return None

    def _extract_grid(self, html, headers_to_find):
        """Extracts values from grid-style tables where one row has labels and the next has values."""
        trs = []
        for match in re.finditer(r'<tr[^>]*>([\s\S]*?)</tr>', html, re.IGNORECASE):
            trs.append(match.group(1))
            
        for i, tr_html in enumerate(trs):
            text_in_tr = self._clean(tr_html).upper()
            found = sum(1 for h in headers_to_find if h in text_in_tr)
            if found >= len(headers_to_find) - 1 and found > 0:
                if i + 1 < len(trs):
                    val_tr = trs[i + 1]
                    val_tds = re.findall(r'<td[^>]*?>([\s\S]*?)</td>', val_tr, re.IGNORECASE)
                    return [self._clean(td) for td in val_tds]
        return []

    def _extract_charge(self, label, html):
        """Extracts a value that sits in the next <td> after the label's <td> in the same <tr>."""
        l_esc = re.escape(label)
        for tr_match in re.finditer(r'<tr[^>]*>([\s\S]*?)</tr>', html, re.IGNORECASE):
            tr_html = tr_match.group(1)
            if re.search(l_esc, tr_html, re.IGNORECASE):
                tds = re.findall(r'<td[^>]*?>([\s\S]*?)</td>', tr_html, re.IGNORECASE)
                for i, td in enumerate(tds):
                    if re.search(l_esc, td, re.IGNORECASE):
                        if i + 1 < len(tds):
                            return self._clean(tds[i + 1])
        return ""

    def _extract_numbers(self, text):
        """Extract numeric tokens from a string (integers or decimals)."""
        if not text:
            return []
        return re.findall(r'\d+(?:\.\d+)?', text)

    def _parse_number(self, value):
        """Safely parse a numeric string to float, treating empty/invalid as 0."""
        if value is None:
            return 0.0
        try:
            return float(str(value).replace(",", "").strip())
        except Exception:
            return 0.0

    def _extract_fpa_taxes(self, html):
        """Extract the FPA tax breakdown values from the bill HTML."""
        match = re.search(
            r'<b>\s*GST ON FPA\s*</b>[\s\S]*?</td>\s*<td[^>]*>([\s\S]*?)</td>',
            html, re.IGNORECASE
        )
        if not match:
            return {}

        nums = self._extract_numbers(match.group(1))
        if not nums:
            return {}

        # The FPA section typically lists each tax value and then a final total.
        total = nums[-1]
        tax_values = nums[:-1]

        keys = [
            "gst_on_fpa",
            "ed_on_fpa",
            "further_tax_on_fpa",
            "stax_on_fpa",
            "it_on_fpa",
            "et_on_fpa",
        ]

        result = {}
        for i, key in enumerate(keys):
            result[key] = tax_values[i] if i < len(tax_values) else ""
        result["total"] = total
        return result

    def _extract_lp_surcharge(self, html):
        """Extract LP surcharge breakdown and due-date totals."""
        match = re.search(r'<b>\s*L\.P\.SURCHARGE\s*</b>[\s\S]*?<td[^>]*>([\s\S]*?)</td>', html, re.IGNORECASE)
        if not match:
            return {}

        cell = match.group(1)
        ranges = []
        for m in re.finditer(
            r'(\d+(?:\.\d+)?)\s*<br\s*/?>\s*<strong>\s*(Till|After)\s*([^<]+)</strong>\s*<br\s*/?>\s*([\d\.]+)',
            cell, re.IGNORECASE,
        ):
            surcharge = m.group(1).strip()
            label = f"{m.group(2).strip()} {m.group(3).strip()}"
            total = m.group(4).strip()
            ranges.append({"label": label, "surcharge": surcharge, "total": total})

        if not ranges:
            return {}

        return {
            "lp_surcharge": ranges[0]["surcharge"],
            "after_due_date": ranges[-1]["total"],
            "after_due_date_ranges": ranges,
        }

    def _parse_bill(self, html, ref_no):
        """Extracts comprehensive structured data from FESCO bill HTML using strict structural parsing."""
        data = {
            "reference_number": ref_no,
            "consumer_details": {
                "consumer_id": "", "tariff": "", "load": "", "old_ac_number": "", "reference_full": "",
                "lock_age": "", "no_of_acs": "", "un_bill_age": "", "name": "", "father_name": "", "address": "", "cnic": ""
            },
            "connection_details": {
                "connection_date": "", "connected_load": "", "curr_mdi": "", "ed_at": "",
                "bill_month": "", "reading_date": "", "issue_date": "", "due_date": "",
                "division": "", "sub_division": "", "feeder_name": ""
            },
            "billing_details": {
                "meter_no": "", "previous_reading": "", "present_reading": "", 
                "mf": "", "units_consumed": "", "status": ""
            },
            "charges_breakdown": {
                "fesco_charges": {"units_consumed": "", "cost_of_electricity": "", "meter_rent_fix": "", "service_rent": "", "fuel_adj": "", "fc_surcharge": "", "total": ""},
                "govt_charges": {"electricity_duty": "", "tv_fee": "", "gst": "", "income_tax": "", "extra_tax": "", "further_tax": "", "retailer_stax": "", "total": ""},
                "taxes_on_fpa": {"gst_on_fpa": "", "ed_on_fpa": "", "further_tax_on_fpa": "", "stax_on_fpa": "", "it_on_fpa": "", "et_on_fpa": "", "total": ""},
                "total_charges": {"arrear_age": "", "current_bill": "", "bill_adj": "", "installment": "", "subsidies": "", "total_fpa": ""}
            },
            "billing_history": [],
            "total_payable": {"within_due_date": "", "lp_surcharge": "", "after_due_date": "", "after_due_date_ranges": []},
            "additional_info": {"bill_no": "", "deferred_amount": "", "outstanding_inst_amount": "", "progress_gst_paid_fy": "", "progress_it_paid_fy": ""}
        }

        # Identify Major High-Level Blocks (include total charges section)
        charges_match = re.search(r'FESCO[\s\S]*?TOTAL\s+CHARGES[\s\S]*?(?=BILL\s+CALCULATION|PAYABLE\s+WITHIN|$)', html, re.IGNORECASE)
        ch_txt = charges_match.group(0) if charges_match else html

        # Grids
        conn_p = self._extract_grid(html, ["CONNECTION DATE", "CONNECTED LOAD", "BILL MONTH"])
        cons_p = self._extract_grid(html, ["CONSUMER ID", "TARIFF", "LOAD"])
        ref_p = self._extract_grid(html, ["REFERENCE NO", "NO OF ACS"])
        meter_p = self._extract_grid(html, ["METER NO", "PREVIOUS", "PRESENT"])

        data["consumer_details"].update({
            "consumer_id": cons_p[0] if len(cons_p) > 0 else "",
            "tariff": cons_p[1] if len(cons_p) > 1 else "",
            "load": cons_p[2] if len(cons_p) > 2 else "",
            "old_ac_number": cons_p[3] if len(cons_p) > 3 else "",
            "reference_full": ref_p[0] if len(ref_p) > 0 else "",
            "lock_age": ref_p[1] if len(ref_p) > 1 else "",
            "no_of_acs": ref_p[2] if len(ref_p) > 2 else "",
            "un_bill_age": ref_p[3] if len(ref_p) > 3 else ""
        })

        data["connection_details"].update({
            "connection_date": conn_p[0] if len(conn_p) > 0 else "",
            "connected_load": conn_p[1] if len(conn_p) > 1 else "",
            "curr_mdi": conn_p[2] if len(conn_p) > 2 else "",
            "ed_at": conn_p[3] if len(conn_p) > 3 else "",
            "bill_month": conn_p[4] if len(conn_p) > 4 else "",
            "reading_date": conn_p[5] if len(conn_p) > 5 else "",
            "issue_date": conn_p[6] if len(conn_p) > 6 else "",
            "due_date": conn_p[7] if len(conn_p) > 7 else (conn_p[6] if len(conn_p) > 6 else ""), # handle missing ED@ column variation
            "division": self._extract_charge("DIVISION", html),
            "sub_division": self._extract_charge("SUB DIVISION", html),
            "feeder_name": self._extract_charge("FEEDER NAME", html)
        })

        data["billing_details"].update({
            "meter_no": meter_p[0] if len(meter_p) > 0 else "",
            "previous_reading": meter_p[1] if len(meter_p) > 1 else "",
            "present_reading": meter_p[2] if len(meter_p) > 2 else "",
            "mf": meter_p[3] if len(meter_p) > 3 else "",
            "units_consumed": meter_p[4] if len(meter_p) > 4 else "",
            "status": meter_p[5] if len(meter_p) > 5 else ""
        })

        # Name, Father Name & Address (Refined for <span> structure)
        name_p = re.search(r'NAME\s*(?:&|&amp;)\s*ADDRESS[\s\S]*?(<span>[\s\S]*?</p>)', html, re.IGNORECASE)
        if name_p:
             spans = re.findall(r'<span>([\s\S]*?)</span>', name_p.group(1), re.IGNORECASE)
             cleaned_spans = [self._clean(s) for s in spans if self._clean(s)]
             if cleaned_spans:
                  data["consumer_details"]["name"] = cleaned_spans[0]
                  if len(cleaned_spans) > 1:
                      data["consumer_details"]["father_name"] = cleaned_spans[1]
                  if len(cleaned_spans) > 2:
                      data["consumer_details"]["address"] = ", ".join(cleaned_spans[2:])

        # CNIC
        cnic_m = re.search(r'<h4>CNIC\s*</h4>\s*</td>\s*<td[^>]*?>([\s\S]*?)</td>', html, re.IGNORECASE)
        if cnic_m:
             data["consumer_details"]["cnic"] = self._clean(cnic_m.group(1))
        elif re.search(r'CNIC:\s*(\d+)', html):
             data["consumer_details"]["cnic"] = re.search(r'CNIC:\s*(\d+)', html).group(1)

        # Charges
        for key, labels in {
            "fesco_charges": [("cost_of_electricity", "COST OF ELECTRICITY"), ("meter_rent_fix", "METER RENT"), ("service_rent", "SERVICE RENT"), ("fuel_adj", "FUEL PRICE ADJUSTMENT"), ("fc_surcharge", "F.C SURCHARGE"), ("total", "TOTAL")],
            "govt_charges": [("electricity_duty", "ELECTRICITY DUTY"), ("tv_fee", "TV FEE"), ("gst", "GST"), ("income_tax", "INCOME TAX"), ("extra_tax", "EXTRA TAX"), ("further_tax", "FURTHER TAX"), ("retailer_stax", "RETAILER STAX"), ("total", "TOTAL")],
            "taxes_on_fpa": [("gst_on_fpa", "GST ON FPA"), ("ed_on_fpa", "ED ON FPA"), ("further_tax_on_fpa", "FURTHER TAX ON FPA"), ("stax_on_fpa", "S.TAX ON FPA"), ("it_on_fpa", "IT ON FPA"), ("et_on_fpa", "ET ON FPA"), ("total", "TOTAL TAXES ON FPA")],
            "total_charges": [("arrear_age", "ARREAR/AGE"), ("current_bill", "CURRENT BILL"), ("bill_adj", "BILL ADJUSTMENT"), ("installment", "INSTALLEMENT"), ("subsidies", "SUBSIDIES"), ("total_fpa", "TOTAL FPA")]
        }.items():
            for f_key, label in labels:
                 # Extract from the charges block to avoid unrelated tables (like FESCO GST No.)
                 data["charges_breakdown"][key][f_key] = self._extract_charge(label, ch_txt)

        # Override taxes-on-FPA values with structured parsing (FPA section uses multi-line cells)
        data["charges_breakdown"]["taxes_on_fpa"].update(self._extract_fpa_taxes(html))

        # Ensure FESCO units consumed is present (some bills leave it blank)
        if not data["charges_breakdown"]["fesco_charges"]["units_consumed"]:
            data["charges_breakdown"]["fesco_charges"]["units_consumed"] = data["billing_details"].get("units_consumed", "")

        # Correct govt charges total if it appears incorrect (e.g., reused FESCO total cell)
        govt = data["charges_breakdown"]["govt_charges"]
        computed_govt_total = sum(
            self._parse_number(govt.get(k))
            for k in ["electricity_duty", "tv_fee", "gst", "income_tax", "extra_tax", "further_tax", "retailer_stax"]
        )
        if computed_govt_total:
            existing_total = self._parse_number(govt.get("total"))
            if existing_total == 0 or abs(existing_total - computed_govt_total) > 0.01:
                govt["total"] = str(int(computed_govt_total) if computed_govt_total.is_integer() else round(computed_govt_total, 2))

        # History (month-wise bill/payment history)
        history_table = re.search(r'(<table[^>]*>[\s\S]*?<h4>\s*MONTH\s*</h4>[\s\S]*?</table>)', html, re.IGNORECASE)
        if history_table:
            for row in re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', history_table.group(1), re.IGNORECASE):
                if re.search(r'<h4>\s*MONTH\s*</h4>', row, re.IGNORECASE):
                    continue
                cells = re.findall(r'<td[^>]*?>([\s\S]*?)</td>', row, re.IGNORECASE)
                if len(cells) >= 4:
                    month = self._clean(cells[0])
                    if re.match(r'^[A-Za-z]{3}\d{2}$', month):
                        units = self._clean(cells[1]).split()[-1] if self._clean(cells[1]) else ""
                        data["billing_history"].append({
                            "month": month,
                            "units": units,
                            "bill": self._clean(cells[2]),
                            "payment": self._clean(cells[3])
                        })

        # Summary
        data["total_payable"].update({
            "within_due_date": self._extract_charge("PAYABLE WITHIN DUE DATE", html),
            "after_due_date": self._extract_charge("PAYABLE AFTER DUE DATE", html),
            "lp_surcharge": self._extract_charge("L.P.SURCHARGE", html)
        })

        # Derive LP-surcharge ranges and after-due totals
        lp_details = self._extract_lp_surcharge(html)
        if lp_details:
            data["total_payable"].update(lp_details)

        return data




    def _make_html_portable(self, html):
        """Converts relative URLs to absolute ones and inlines major CSS files."""
        domain = "https://bill.pitc.com.pk"
        
        # Inline common CSS for better PDF rendering and offline support
        css_links = re.findall(r'href="(/styles/[^"]+\.css)"', html)
        for css_path in css_links:
            url = domain + css_path
            try:
                with self.opener.open(url) as response:
                    css_content = response.read().decode('utf-8')
                    # Pre-process CSS to fix relative paths inside CSS (like backgrounds)
                    css_abs = css_content.replace('url(/', f'url({domain}/')
                    html = html.replace(f'<link href="{css_path}" rel="stylesheet" type="text/css" />', 
                                      f'<style>{css_abs}</style>')
            except Exception as e:
                logger.debug(f"[!] Warning: Could not inline CSS {url}: {e}")
        
        # Make remaining relative paths absolute
        html = html.replace('href="/', f'href="{domain}/')
        html = html.replace('src="/', f'src="{domain}/')
        
        return html

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch FESCO Bill as HTML or JSON")
    parser.add_argument("ref_no", help="14-digit reference number")
    parser.add_argument("--json", action="store_true", help="Output result as JSON instead of saving file")
    
    args = parser.parse_args()
    
    fetcher = FescoFetcher()
    fetcher.fetch_bill(args.ref_no, output_json=args.json)
