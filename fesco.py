#!/usr/bin/env python3
# python3 fesco_fetcher.py 08131842083435
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
        if not text: return ""
        text = re.sub(r'<[^>]+>', ' ', text) # Strip HTML
        text = re.sub(r'&\w+;', ' ', text)   # Strip HTML entities
        text = re.sub(r'\s+', ' ', text).strip() # Squeeze whitespace
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

    def _parse_bill(self, html, ref_no):
        """Extracts comprehensive structured data from FESCO bill HTML using strict structural parsing."""
        data = {
            "reference_number": ref_no.replace(" ", ""),
            "consumer_details": {
                "consumer_id": "", "tariff": "", "load": "", "old_ac_number": "", 
                "reference_full": "", "lock_age": "", "no_of_acs": "", "un_bill_age": "",
                "name": "", "address": "", "cnic": ""
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

        # Identify Major High-Level Blocks
        # (Splitting by content avoids getting wrong values from other sections)
        sections = {
            "header": re.split(r'CONSUMER\s*ID', html, maxsplit=1, flags=re.IGNORECASE)[0],
            "consumer": re.search(r'CONSUMER\s*ID[\s\S]*?(?=METER\s*NO)', html, re.IGNORECASE),
            "meter": re.search(r'METER\s*NO[\s\S]*?(?=FESCO\s*CHARGES)', html, re.IGNORECASE),
            "charges": re.search(r'FESCO\s*CHARGES[\s\S]*?(?=BILLING\s*HISTORY|MONTH\s+UNITS)', html, re.IGNORECASE),
            "history": re.search(r'MONTH\s+UNITS[\s\S]*?</table>', html, re.IGNORECASE),
            "footer": re.search(r'BILL\s*MONTH[\s\S]*?PAYABLE\s*WITHIN\s*DUE\s*DATE[\s\S]*?</table>', html, re.IGNORECASE)
        }

        # Helper to get values from a labels-then-values row pair
        def get_row_pair(labels, block_text):
             for match in re.finditer(r'<tr[^>]*>([\s\S]*?)</tr>', block_text, re.IGNORECASE):
                  row_content = match.group(1)
                  if all(re.search(re.escape(l), row_content, re.IGNORECASE) for l in labels):
                       # Found the header row, now find the NEXT row
                       next_part = block_text[match.end():]
                       val_match = re.search(r'<tr[^>]*>([\s\S]*?)</tr>', next_part, re.IGNORECASE)
                       if val_match:
                            return [self._clean(c) for c in re.findall(r'<td[^>]*?>([\s\S]*?)</td>', val_match.group(1), re.IGNORECASE)]
             return []

        # 1. Header (Top)
        head_vals = get_row_pair(["CONNECTION DATE", "DUE DATE"], sections["header"])
        # Some bills might have fewer columns or extra spaces
        if not head_vals:
            # Try a subset of labels
            head_vals = get_row_pair(["CONNECTION DATE", "BILL MONTH"], sections["header"])
        
        if len(head_vals) >= 7:
             data["connection_details"].update({
                 "connection_date": head_vals[0], 
                 "connected_load": head_vals[1], 
                 "ed_at": head_vals[2], 
                 "bill_month": head_vals[3], 
                 "reading_date": head_vals[4], 
                 "issue_date": head_vals[5], 
                 "due_date": head_vals[6]
             })

        # 2. Consumer Stats
        if sections["consumer"]:
             c_txt = sections["consumer"].group(0)
             cons = get_row_pair(["CONSUMER ID", "TARIFF"], c_txt)
             if len(cons) >= 4: data["consumer_details"].update({"consumer_id": cons[0], "tariff": cons[1], "load": cons[2], "old_ac_number": cons[3]})
             
             refs = get_row_pair(["REFERENCE NO", "UN-BILL-AGE"], c_txt)
             if len(refs) >= 4: data["consumer_details"].update({"reference_full": refs[0], "lock_age": refs[1], "no_of_acs": refs[2], "un_bill_age": refs[3]})

             data["connection_details"].update({"division": self._find_val("DIVISION", c_txt), "sub_division": self._find_val("SUB DIVISION", c_txt), "feeder_name": self._find_val("FEEDER NAME", c_txt)})

        # 3. Name & Address
        name_match = re.search(r'<span>NAME\s*&\s*ADDRESS</span>([\s\S]*?)</td>', html, re.IGNORECASE)
        if name_match:
             lines = [self._clean(s) for s in re.findall(r'<span>([\s\S]*?)</span>', name_match.group(1), re.IGNORECASE) if self._clean(s)]
             if lines:
                  data["consumer_details"]["name"] = lines[0]
                  data["consumer_details"]["address"] = ", ".join(lines[1:])

        # 4. Meter Stats
        if sections["meter"]:
             m_txt = sections["meter"].group(0)
             m_vals = get_row_pair(["METER NO", "STATUS"], m_txt)
             if len(m_vals) >= 5: data["billing_details"].update({"meter_no": m_vals[0], "previous_reading": m_vals[1], "present_reading": m_vals[2], "mf": m_vals[3], "units_consumed": m_vals[4]})

        # 5. Charges Breakdown
        if sections["charges"]:
             c_txt = sections["charges"].group(0)
             # Sub-divide charges
             sub_sects = {
                 "fesco": re.search(r'FESCO\s*CHARGES[\s\S]*?(?=GOVERNMENT\s*CHARGES)', c_txt, re.IGNORECASE),
                 "govt": re.search(r'GOVERNMENT\s*CHARGES[\s\S]*?(?=TOTAL\s*TAXES\s*ON\s*FPA)', c_txt, re.IGNORECASE),
                 "fpa": re.search(r'TOTAL\s*TAXES\s*ON\s*FPA[\s\S]*?(?=ARREAR/AGE)', c_txt, re.IGNORECASE),
                 "total": re.search(r'ARREAR/AGE[\s\S]*', c_txt, re.IGNORECASE)
             }
             
             for key, label_list in {
                 "fesco_charges": [("cost_of_electricity", "COST OF ELECTRICITY"), ("meter_rent_fix", "METER RENT"), ("service_rent", "SERVICE RENT"), ("fuel_adj", "FUEL PRICE ADJUSTMENT"), ("fc_surcharge", "F.C SURCHARGE"), ("total", "TOTAL")],
                 "govt_charges": [("electricity_duty", "ELECTRICITY DUTY"), ("tv_fee", "TV FEE"), ("gst", "GST"), ("income_tax", "INCOME TAX"), ("extra_tax", "EXTRA TAX"), ("further_tax", "FURTHER TAX"), ("retailer_stax", "RETAILER STAX"), ("total", "TOTAL")],
                 "taxes_on_fpa": [("gst_on_fpa", "GST ON FPA"), ("ed_on_fpa", "ED ON FPA"), ("further_tax_on_fpa", "FURTHER TAX ON FPA"), ("stax_on_fpa", "S.TAX ON FPA"), ("it_on_fpa", "IT ON FPA"), ("et_on_fpa", "ET ON FPA"), ("total", "TOTAL TAXES ON FPA")],
                 "total_charges": [("arrear_age", "ARREAR/AGE"), ("current_bill", "CURRENT BILL"), ("bill_adj", "BILL ADJUSTMENT"), ("installment", "INSTALLEMENT"), ("subsidies", "SUBSIDIES"), ("total_fpa", "TOTAL FPA")]
             }.items():
                 sub_match = sub_sects[key.split("_")[0]]
                 if sub_match:
                      for f_key, label in label_list:
                           data["charges_breakdown"][key][f_key] = self._find_val(label, sub_match.group(0))

        # 6. History
        if sections["history"]:
             for row in re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', sections["history"].group(0), re.IGNORECASE):
                  c = re.findall(r'<td[^>]*?>([\s\S]*?)</td>', row, re.IGNORECASE)
                  if len(c) >= 4:
                       month = self._clean(c[0])
                       if re.match(r'^[A-Z][a-z]{2}\s*\d{2}$', month, re.IGNORECASE):
                            data["billing_history"].append({"month": month, "units": self._clean(c[1]).split()[-1] if self._clean(c[1]) else "0", "bill": self._clean(c[2]), "payment": self._clean(c[3])})

        # 7. Footer Totals
        if sections["footer"]:
             f_txt = sections["footer"].group(0)
             data["total_payable"]["within_due_date"] = self._find_val("PAYABLE WITHIN DUE DATE", f_txt)
             data["total_payable"]["lp_surcharge"] = self._find_val("L.P.SURCHARGE", f_txt)
             
             after_cell = re.search(r'PAYABLE\s*AFTER\s*DUE\s*DATE[\s\S]*?<td[^>]*?class="[^"]*content[^"]*"[^>]*>([\s\S]*?)</td>', f_txt, re.IGNORECASE)
             if after_cell:
                  v_txt = after_cell.group(1)
                  ranges = []
                  for r_match in re.finditer(r'<strong>\s*(Till|After)\s*([\-\w\d\s]+)\s*</strong>\s*<br\s*/>\s*([\d\.\, ]+)', v_txt, re.IGNORECASE):
                       ranges.append({"label": self._clean(r_match.group(1)), "date": self._clean(r_match.group(2)), "amount": self._clean(r_match.group(3))})
                  data["total_payable"]["after_due_date_ranges"] = ranges
                  data["total_payable"]["after_due_date"] = self._clean(v_txt.split("<br")[0]) if not ranges else ""

        # 8. Extra Info
        cnic = re.search(r'CNIC\s*</td>\s*<td[^>]*?>\s*([\d-]*)', html, re.IGNORECASE)
        if cnic: data["consumer_details"]["cnic"] = cnic.group(1).strip()
        
        bill_no = re.search(r'BILL\s*NO\s*:\s*(\d+)', html, re.IGNORECASE)
        if bill_no: data["additional_info"]["bill_no"] = bill_no.group(1)

        for k, v in {"deferred_amount": "DEFERRED AMOUNT", "outstanding_inst_amount": "OUTSTANDING INST. AMOUNT", "progress_gst_paid_fy": "PROG. GST PAID F-Y", "progress_it_paid_fy": "PROG. IT PAID F-Y"}.items():
             data["additional_info"][k] = self._find_val(v, html)

        return data

    def _find_val(self, label, block):
        """Finds value for a label within a scoped block of HTML."""
        l_esc = re.escape(label)
        # Search for label in h4, b, or td, then find next content cell or just next td
        # Ensure we don't cross too many cells to find it
        patterns = [
            rf'{l_esc}[\s\S]*?<td[^>]*?class="[^"]*content[^"]*"[^>]*>([\s\S]*?)</td>',
            rf'{l_esc}[\s\S]*?<td[^>]*?>([\s\S]*?)</td>'
        ]
        for pat in patterns:
             match = re.search(pat, block, re.IGNORECASE)
             if match:
                  # Check if we accidentally skipped another label
                  overlap = block[match.start():match.end()]
                  # If the found segment contains other <h4> or <b> labels besides current, it might be a mismatch
                  # (But for charges columns this is okay. For unique fields, this helps.)
                  return self._clean(match.group(1))
        return ""




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
        
        # Remove "bill is loading" overlays, scripts, and CSS
        html = re.sub(r'<div id="loading-bar">[\s\S]*?</div>', '', html, flags=re.IGNORECASE)
        html = re.sub(r'<div id="loading-text">[\s\S]*?</div>', '', html, flags=re.IGNORECASE)
        html = re.sub(r'#loading-bar\s*\{[\s\S]*?\}', '', html, flags=re.IGNORECASE)
        html = re.sub(r'#loading-text\s*\{[\s\S]*?\}', '', html, flags=re.IGNORECASE)
        html = re.sub(r'function showLoadingBar\(\) \{[\s\S]*?\}', '', html, flags=re.IGNORECASE)
        html = re.sub(r'window\.onload\s*=\s*showLoadingBar;?', '', html, flags=re.IGNORECASE)
        
        return html

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch FESCO Bill as HTML or JSON")
    parser.add_argument("ref_no", help="14-digit reference number")
    parser.add_argument("--json", action="store_true", help="Output result as JSON instead of saving file")
    
    args = parser.parse_args()
    
    fetcher = FescoFetcher()
    fetcher.fetch_bill(args.ref_no, output_json=args.json)
