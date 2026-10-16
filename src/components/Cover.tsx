import { hue } from '../utils'

/** Capa gerada a partir do título (os arquivos locais não têm miniatura). */
export default function Cover({ title, className = 'cover-art' }: { title: string; className?: string }) {
  const h = hue(title)
  return (
    <div className={className} style={{ background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 60) % 360} 70% 40%))` }}>
      {title.trim().charAt(0).toUpperCase() || '♪'}
    </div>
  )
}
