// Valor de mercado Libertadores ZC: exponencial no overall + prêmio por potencial (maior para jovens) − desconto de idade.
const FROZEN_AGE=33; // jogadores com idade > 33 não evoluem nem regridem
const frozen=p=>(+p.age||0)>FROZEN_AGE;
const fix=p=>{if(p){if(p.potential==null||+p.potential<+p.overall)p.potential=p.overall;if(frozen(p))p.potential=p.overall;}return p;};
// overall nunca passa do potencial (e >33 anos não muda)
const capOverall=(p,novo)=>frozen(p)?p.overall:Math.min(novo,Math.max(+p.potential||p.overall,p.overall));
module.exports=p=>{fix(p);const o=+p.overall||50,pot=Math.max(o,+p.potential||o),a=+p.age||25,g=pot-o;
 let v=6e6*Math.exp(0.25*(o-75));
 const youth=a<=21?1.5:a<=24?1:a<=28?0.5:0.15;v*=1+0.08*g*youth;
 if(a>=31)v*=Math.max(0.3,1-0.08*(a-30));
 const st=v>=1e7?5e5:v>=1e6?1e5:1e4;return Math.max(1e4,Math.round(v/st)*st);};

module.exports.frozen=frozen;module.exports.capOverall=capOverall;module.exports.fix=fix;module.exports.FROZEN_AGE=FROZEN_AGE;
