import React, { useEffect, useMemo, useRef, useState } from 'react';
import AppSidebar from '../components/AppSidebar';
import { documentation } from './documentation-content';
import './documentation.css';

const modules = [{ id: 'start', title: 'Get Started', description: 'Learn to organize your work, build a model and explore results.' }, { id: 'pls', title: 'PLS-SEM', description: 'Understand the methods, settings and results behind your analysis.' }] as const;
const sectionLabel = (title: string, index: number) => {
  const values: Array<[number, string]> = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let number = index + 1;
  let roman = '';
  for (const [value, numeral] of values) while (number >= value) { roman += numeral; number -= value; }
  return `${roman}. ${title.replace(/^\d+\.\s*/, '')}`;
};

export default function DocumentationView() {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState<'start' | 'pls' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const article = documentation.find(item => item.id === selected);
  const matches = useMemo(() => {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return documentation.flatMap(item => item.sections.filter(section => terms.every(term => `${item.title} ${item.description} ${section.title} ${section.text.join(' ')} ${(section.steps || []).join(' ')} ${section.note || ''} ${section.example?.caption || ''}`.toLowerCase().includes(term))).map(section => ({ item, section })));
  }, [query]);
  useEffect(() => { if (target && article) { document.getElementById(`documentation-${target}`)?.scrollIntoView({ block: 'start' }); setTarget(null); } }, [target, article]);
  const open = (id: string, section?: string) => { const item = documentation.find(entry => entry.id === id); if (!item) return; setModule(item.module); setSelected(id); setQuery(''); if (section) setTarget(section); else main.current?.scrollTo({ top: 0 }); };
  return <div className="app-body"><AppSidebar activeNav="docs"/><main className="ws-main" ref={main}><div className="ws-inner">
    <header className="ws-header"><div className="ws-header__left"><h1 className="ws-title-editable" style={{ cursor: 'default' }}>Documentation</h1></div></header>
    <div className="documentation"><label className="documentation__search"><span className="documentation__sr-only">Search documentation</span><input type="search" placeholder="Search documentation" value={query} onChange={e => setQuery(e.target.value)}/></label>
      {query.trim() ? <div className="documentation__list" aria-live="polite"><h2>Search results</h2>{matches.length ? matches.map(({ item, section }) => <button type="button" key={`${item.id}-${section.id}`} onClick={() => open(item.id, section.id)}><strong>{section.title}</strong><span>{modules.find(m => m.id === item.module)?.title} / {item.title}</span></button>) : <p>No matching topics found.</p>}</div>
      : article ? <><button type="button" className="documentation__back" onClick={() => setSelected(null)}>← {modules.find(m => m.id === module)?.title}</button><article className="documentation__article"><h2>{article.title}</h2><p className="documentation__intro">{article.description}</p><nav className="documentation__contents" aria-label="On this page">{article.sections.map((section, index) => <a key={section.id} href={`#documentation-${section.id}`}>{sectionLabel(section.title, index)}</a>)}</nav>{article.sections.map((section, index) => <section id={`documentation-${section.id}`} key={section.id}><h3>{sectionLabel(section.title, index)}</h3>{section.text.map((text, i) => <p key={i}>{text}</p>)}{section.steps && <ol className="documentation__steps">{section.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>}{section.example && <figure className="documentation__example"><div className="documentation__table-wrap"><table><thead><tr>{section.example.headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{section.example.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value}</td>)}</tr>)}</tbody></table></div><figcaption>{section.example.caption}</figcaption></figure>}{section.note && <aside className="documentation__note">{section.note}</aside>}</section>)}</article></>
      : module ? <><button type="button" className="documentation__back" onClick={() => setModule(null)}>← Documentation</button><h2 className="documentation__heading">{modules.find(m => m.id === module)?.title}</h2><div className="documentation__list">{documentation.filter(item => item.module === module).map(item => <button type="button" key={item.id} onClick={() => open(item.id)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div></>
      : <div className="documentation__list">{modules.map(item => <button type="button" key={item.id} onClick={() => setModule(item.id)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div>}
    </div></div></main></div>;
}
