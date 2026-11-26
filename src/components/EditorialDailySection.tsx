import React, { useEffect, useState } from 'react';
import { BookOpen, Calendar, ShieldCheck } from 'lucide-react';
import { EditorialPost } from '../types.ts';
import { ResilientImage } from './ResilientImage.tsx';
import { trackText } from '../lib/intent.ts';
import { FuturisticModalHeader } from './DesignSystem.tsx';

interface EditorialDailySectionProps {
  initialPostSlug?: string | null;
}

export const EditorialDailySection: React.FC<EditorialDailySectionProps> = ({ initialPostSlug }) => {
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [selectedPost, setSelectedPost] = useState<EditorialPost | null>(null);

  // Leitura conta como interesse no destino; leitura longa (25s+) conta mais.
  useEffect(() => {
    if (!selectedPost) return;
    const text = `${selectedPost.title} ${selectedPost.summary || ''} ${selectedPost.body.slice(0, 600)}`;
    trackText(text, 'leitura');
    const t = setTimeout(() => trackText(text, 'leitura-longa'), 25000);
    return () => clearTimeout(t);
  }, [selectedPost]);

  useEffect(() => {
    fetch('/api/posts')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.posts || []) as EditorialPost[];
        setPosts(list);
        if (initialPostSlug) {
          const found = list.find((p) => p.slug === initialPostSlug);
          if (found) setSelectedPost(found);
        }
      })
      .catch(() => {});
  }, [initialPostSlug]);

  const categories = ['all', ...Array.from(new Set(posts.map((p) => p.category)))];
  const visible =
    category === 'all' ? posts : posts.filter((p) => p.category === category);

  return (
    <section id="publicacoes" className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#FF1493]">
            <span>📰 Dicas e roteiros novos todos os dias</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold text-[#111111] mt-1 tracking-tight">
            Jornal &amp; Guia Froc Rota
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border-2 border-[#111111]/15 rounded-xl">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                category === cat
                  ? 'bg-[#111111] text-[#39FF14]'
                  : 'text-[#111111]/70 hover:text-[#111111]'
              }`}
            >
              {cat === 'all' ? 'Todas' : cat}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="p-8 rounded-2xl bg-white border-2 border-[#111111]/10 text-sm text-[#111111]/70 font-medium">
          Carregando publicações diárias...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.slice(0, 6).map((post) => (
            <article
              key={post.id}
              className="froc-luminous-border bg-white rounded-2xl overflow-hidden flex flex-col justify-between transition-transform duration-300 hover:-translate-y-1"
            >
              <div>
                <div className="aspect-[16/10] overflow-hidden relative bg-[#111111]">
                  <ResilientImage
                    src={post.coverImage}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-3 left-3 px-2.5 py-1 rounded-md bg-[#111111]/90 border border-[#FFD700]/60 text-[#FFD700] text-[10px] font-bold uppercase tracking-wider">
                    {post.category}
                  </span>
                </div>
                <div className="p-5 space-y-2">
                  <div className="flex items-center justify-between text-[11px] text-[#111111]/65 font-semibold">
                    <span className="text-[#FF1493] font-bold">Guia Froc Rota</span>
                    <span className="inline-flex items-center gap-1 font-mono-tabular">
                      <Calendar className="w-3 h-3" />
                      {post.publishDate}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-[#111111] leading-snug">
                    {/* Link real para o Google seguir; no site abre a leitura sem sair da página. */}
                    <a
                      href={`/blog/${post.slug}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelectedPost(post);
                      }}
                      className="hover:underline"
                    >
                      {post.title}
                    </a>
                  </h3>
                  <p className="text-xs text-[#111111]/75 line-clamp-3 leading-relaxed">
                    {post.summary || post.body.replace(/^##\s.*$/gm, '').slice(0, 160)}
                  </p>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-[#111111]/10 flex items-center justify-between text-xs bg-white">
                <span className="text-[11px] text-[#111111]/70 inline-flex items-center gap-1 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#111111]" />
                  Conteúdo original
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedPost(post)}
                  className="froc-btn-neon inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Ler artigo</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selectedPost && (
        <div className="fixed inset-0 z-[85] bg-[#111111]/70 backdrop-blur-sm overflow-y-auto p-4 md:p-8 flex justify-center items-start">
          <article className="froc-animate-popup w-full max-w-3xl bg-white rounded-2xl border-2 border-[#FFD700] shadow-2xl overflow-hidden my-4">
            <FuturisticModalHeader
              title={selectedPost.title}
              subtitle={`${selectedPost.category} · Publicado em ${selectedPost.publishDate}`}
              icon={<BookOpen className="w-4 h-4" />}
              onBack={() => setSelectedPost(null)}
              onClose={() => setSelectedPost(null)}
            />
            <div className="aspect-[16/9] relative bg-[#111111]">
              <ResilientImage
                src={selectedPost.coverImage}
                alt={selectedPost.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 md:p-8 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#111111]/65">
                <span className="font-bold text-[#FF1493]">
                  {selectedPost.category} · {selectedPost.publishDate}
                </span>
              </div>
              <h3 className="text-2xl font-extrabold text-[#111111] leading-snug">
                {selectedPost.title}
              </h3>
              {selectedPost.summary && <p className="text-sm font-semibold text-[#111111]/80">{selectedPost.summary}</p>}
              <div className="pt-4 border-t border-[#111111]/10 text-sm text-[#111111] leading-relaxed space-y-3">
                {selectedPost.body
                  .split(/\n+/)
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((l, i) =>
                    /^#{2,3}\s/.test(l) ? (
                      <h4 key={i} className="text-base font-extrabold pt-2">
                        {l.replace(/^#{2,3}\s/, '')}
                      </h4>
                    ) : (
                      <p key={i}>{l}</p>
                    )
                  )}
              </div>
              {selectedPost.keywordsJson?.length > 0 && (
                <div className="pt-4 border-t border-[#111111]/10 text-xs text-[#111111]/65">
                  <strong>SEO:</strong> {selectedPost.keywordsJson.join(' · ')}
                </div>
              )}
              <div className="pt-4 border-t border-[#111111]/10 flex justify-end gap-2">
                <a
                  href={`/blog/${selectedPost.slug}`}
                  className="px-3 py-2 rounded-lg border border-[#111111]/25 text-xs font-bold text-[#111111]"
                >
                  Página do artigo
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedPost(null)}
                  className="froc-btn-neon px-5 py-2.5 rounded-xl text-xs font-extrabold"
                >
                  Voltar ao Guia
                </button>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
};
