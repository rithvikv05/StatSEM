import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { SavBufferReader as SavReader } from 'sav-reader';
import { Buffer } from 'buffer';

export interface ParsedVariable {
  name: string;
  missingCount: number;
  scaleType: 'Metric' | 'Ordinal' | 'Categorical';
  min: number;
  max: number;
  selected: boolean;
  type: 'numeric' | 'string';
  category: string;
}

export interface ParsedDataset {
  id?: string;
  filename: string;
  variables: ParsedVariable[];
  rows: any[][]; // array of arrays (rows)
}

function guessCategory(name: string): string {
  if (name.includes('_')) {
    return name.split('_')[0].toUpperCase();
  }
  return 'General';
}

export interface ProcessOptions {
  missingValueMarker?: string; // e.g. "-99"
  treatment?: 'none' | 'listwise' | 'mean';
}

function isMissingValue(val: any, markers: string[]): boolean {
  if (val === null || val === undefined || val === '') return true;
  const str = String(val).trim();
  if (str === '' || str.toLowerCase() === 'na' || str.toLowerCase() === 'nan' || str.toLowerCase() === 'null') {
    return true;
  }
  for (const m of markers) {
    if (str === m) return true;
    const numVal = Number(val);
    const numM = Number(m);
    if (!isNaN(numVal) && !isNaN(numM) && numVal === numM) {
      return true;
    }
  }
  return false;
}

export function processData(
  filename: string,
  headers: string[],
  rawRows: any[][],
  options?: ProcessOptions
): ParsedDataset {
  const markerList = (options?.missingValueMarker || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Filter out completely blank/empty rows (e.g. from trailing empty lines in CSV files)
  const nonBlankRawRows = (rawRows || []).filter(row => {
    if (!row || !Array.isArray(row)) return false;
    return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
  });

  // Step 1: Replace all designated missing values with null
  let processedRows: any[][] = nonBlankRawRows.map(row => {
    return headers.map((_, colIdx) => {
      const cell = row ? row[colIdx] : null;
      if (isMissingValue(cell, markerList)) {
        return null;
      }
      return cell;
    });
  });

  // Step 2: Apply Treatment
  if (options?.treatment === 'listwise') {
    processedRows = processedRows.filter(row => {
      return !row.some(val => val === null || val === undefined);
    });
  } else if (options?.treatment === 'mean') {
    // Compute mean for each numeric column
    const colMeans: (number | null)[] = headers.map((_, colIdx) => {
      let sum = 0;
      let count = 0;
      let allNumeric = true;

      for (let r = 0; r < processedRows.length; r++) {
        const val = processedRows[r][colIdx];
        if (val === null || val === undefined) continue;
        const num = Number(val);
        if (isNaN(num)) {
          allNumeric = false;
          break;
        }
        sum += num;
        count++;
      }

      if (allNumeric && count > 0) {
        return sum / count;
      }
      return null;
    });

    // Impute missing values with column mean
    processedRows = processedRows.map(row => {
      return row.map((val, colIdx) => {
        if ((val === null || val === undefined) && colMeans[colIdx] !== null) {
          return Math.round(colMeans[colIdx]! * 10000) / 10000;
        }
        return val;
      });
    });
  }

  // Step 3: Compute Variable Statistics
  const variables: ParsedVariable[] = headers.map((header, colIdx) => {
    let missingCount = 0;
    let min = Infinity;
    let max = -Infinity;
    let isString = false;
    const uniqueValues = new Set<any>();
    
    for (let r = 0; r < processedRows.length; r++) {
      const val = processedRows[r] ? processedRows[r][colIdx] : null;
      if (val === null || val === undefined || val === '') {
        missingCount++;
        continue;
      }
      
      const numVal = Number(val);
      if (isNaN(numVal) || (typeof val === 'string' && val.trim() === '')) {
        isString = true;
        uniqueValues.add(String(val).trim());
      } else {
        uniqueValues.add(numVal);
        if (numVal < min) min = numVal;
        if (numVal > max) max = numVal;
      }
    }
    
    let scaleType: 'Metric' | 'Ordinal' | 'Categorical' = 'Metric';
    if (isString) {
      scaleType = 'Categorical'; // Nominal (text / categorical)
    } else if (uniqueValues.size === 0) {
      scaleType = 'Metric';
    } else if (uniqueValues.size <= 2) {
      scaleType = 'Categorical'; // Nominal (binary, e.g. 0/1, yes/no)
    } else {
      const allIntegers = Array.from(uniqueValues).every(v => Number.isInteger(Number(v)));
      if (allIntegers && uniqueValues.size <= 7) {
        scaleType = 'Ordinal'; // Ordinal (Likert scale items, e.g. 1-5 or 1-7)
      } else {
        scaleType = 'Metric'; // Metric (continuous interval/ratio)
      }
    }
    
    return {
      name: header || `Var_${colIdx+1}`,
      missingCount,
      scaleType,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
      selected: true,
      type: isString ? 'string' : 'numeric',
      category: guessCategory(header || `Var_${colIdx+1}`)
    };
  });

  return {
    filename,
    variables,
    rows: processedRows
  };
}

export async function parseDatasetFile(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      Papa.parse(file, {
        skipEmptyLines: 'greedy',
        complete: (results) => {
          if (!results.data || results.data.length === 0) return reject("Empty file");
          const headers = results.data[0] as string[];
          const rows = results.data.slice(1) as any[][];
          resolve(processData(file.name, headers, rows));
        },
        error: (err) => reject(err)
      });
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const json: any[][] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          if (json.length === 0) return reject("Empty Excel file");
          const headers = json[0].map(h => String(h));
          const rows = json.slice(1);
          resolve(processData(file.name, headers, rows));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    } else if (name.endsWith('.sav')) {
      try {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
             const buffer = Buffer.from(e.target?.result as ArrayBuffer);
             const sav = new SavReader();
             await sav.open(buffer);
             const metadata = sav.meta;
             const headers = metadata.sysvars.map((v: any) => v.name);
             
             const rows: any[][] = [];
             let row;
             while ((row = await sav.readRecord())) {
                rows.push(headers.map(h => row[h]));
             }
             resolve(processData(file.name, headers, rows));
          } catch(err) {
             console.error(err);
             reject("Could not parse .sav file. Ensure it is a valid SPSS file or convert it to CSV.");
          }
        };
        reader.readAsArrayBuffer(file);
      } catch (err) {
        reject(err);
      }
    } else {
      reject("Unsupported file format.");
    }
  });
}
