import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, MessageCircle } from 'lucide-react';

const About = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            to="/"
            className="p-2 rounded-full bg-secondary/60 hover:bg-secondary transition-colors"
            aria-label="Geri"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="font-heading text-lg font-bold text-foreground">Hakkında & Veri Kaynakları</h1>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-5 py-6 space-y-6">
        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-foreground">Hapl nedir?</h2>
          <p className="text-sm text-foreground/80 leading-relaxed">
            Hapl, içeriklerin Türkiye'de hangi platformlarda bulunabileceğini göstermeye çalışan
            bağımsız bir arama aracıdır. Bir inceleme veya keşif uygulaması değildir; zaten bildiğiniz
            içeriğin nerede izlenebileceğini bulmanıza yardım eder.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-foreground">Resmi ortaklık yoktur</h2>
          <p className="text-sm text-foreground/80 leading-relaxed">
            Hapl, listelediği yayın platformlarıyla resmi ortaklık veya endorsement ilişkisi içinde
            değildir. Tüm marka adları ilgili sahiplerine aittir.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-foreground">Veri kaynakları</h2>
          <ul className="text-sm text-foreground/80 leading-relaxed space-y-1.5 list-disc pl-5">
            <li>TMDB (The Movie Database) — başlık, yıl, tür, poster, kullanılabilirlik sinyalleri.</li>
            <li>Platformların kamuya açık katalog sayfaları (yalnızca onaylanmış connector'lar).</li>
            <li>Hapl ekibi ve kullanıcılarının manuel doğrulamaları.</li>
          </ul>
        </section>

        <section className="space-y-2 bg-card/60 border border-border/40 rounded-2xl p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            TMDB Attribution
          </h3>
          <p className="text-xs text-foreground/80 leading-relaxed">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <p className="text-xs text-foreground/80 leading-relaxed">
            Bu ürün TMDB API'sini kullanır; TMDB tarafından onaylanmış veya sertifikalandırılmış değildir.
          </p>
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            themoviedb.org <ExternalLink className="h-3 w-3" />
          </a>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-foreground">Hatalı bilgi bildirimi</h2>
          <p className="text-sm text-foreground/80 leading-relaxed">
            Bir başlığın yanlış platformda göründüğünü ya da eksik bir kaynağı fark ederseniz lütfen
            bildirin. Manuel doğrulama kuyruğuna alıp düzeltiyoruz.
          </p>
          <a
            href="mailto:hello@hapl.app?subject=Hapl%20veri%20bildirimi"
            className="inline-flex items-center gap-2 mt-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <MessageCircle className="h-4 w-4" /> Bildirim gönder
          </a>
        </section>

        <section className="space-y-2">
          <h2 className="font-heading text-base font-bold text-foreground">Gizlilik & telif</h2>
          <p className="text-sm text-foreground/80 leading-relaxed">
            Hapl video, altyazı veya uzun açıklama metni dağıtmaz. Yalnızca bir başlığın hangi
            platformda bulunabileceğine dair minimum metadata gösterilir.
          </p>
        </section>
      </main>
    </div>
  );
};

export default About;
