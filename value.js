// Valor de mercado Libertadores ZC: exponencial no overall + prêmio por potencial (maior para jovens) − desconto de idade.
module.exports=p=>{const o=+p.overall||50,pot=Math.max(o,+p.potential||o),a=+p.age||25,g=pot-o;
 let v=6e6*Math.exp(0.25*(o-75));
 const youth=a<=21?1.5:a<=24?1:a<=28?0.5:0.15;v*=1+0.08*g*youth;
 if(a>=31)v*=Math.max(0.3,1-0.08*(a-30));
 const st=v>=1e7?5e5:v>=1e6?1e5:1e4;return Math.max(1e4,Math.round(v/st)*st);};
