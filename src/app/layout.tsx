'use client';

import Script from 'next/script';
import MixpanelProvider from '@/app/provider/MixpanelProvider';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        id="mp-init"
        strategy="afterInteractive"
      >{`
        (function(f,b){if(!b.__SV){var a,e,i,g;window.mixpanel=b;b._i=[];b.init=function(a,e,d){function f(b,h){var a=h.split(".");2==a.length&&(b=b[a[0]],h=a[1]);b[h]=function(){b.push([h].concat(Array.prototype.slice.call(arguments,0)))}}var c=b;"undefined"!==typeof d?c=b[d]=[]:d="mixpanel";c.people=c.people||[];c.toString=function(b){var a="mixpanel";"mixpanel"!==d&&(a+="."+d);b||(a+=" (stub)");return a};c.people.toString=function(){return c.toString(1)+".people (stub)"};i="disable time_event track track_pageview track_links track_forms register register_once alias unregister identify name_tag set_config reset opt_in_tracking opt_out_tracking has_opted_in_tracking has_opted_out_tracking clear_opt_in_out_tracking people.set people.set_once people.unset people.increment people.append people.union people.track_charge people.clear_charges people.delete_user".split(" ");
        for(g=0;g<i.length;g++)f(c,i[g]);b._i.push([a,e,d])};b.__SV=1.2;a=f.createElement("script");a.type="text/javascript";a.async=!0;a.src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";e=f.getElementsByTagName("script")[0];e.parentNode.insertBefore(a,e)}})(document,window.mixpanel||[]);
        (function(){
          var token="${process.env.NEXT_PUBLIC_MIXPANEL_TOKEN||""}";
          var host="${process.env.NEXT_PUBLIC_MIXPANEL_API_HOST||"https://api.mixpanel.com"}";
          if(!token) return;
          mixpanel.init(token,{api_host:host,track_pageview:false,persistence:"localStorage"});
          var id;
          try{
            id=localStorage.getItem("mp_anon_id");
            if(!id){
              id=(crypto&&crypto.randomUUID&&crypto.randomUUID())||(Math.random().toString(16).slice(2)+Date.now().toString(36));
              localStorage.setItem("mp_anon_id",id);
            }
          }catch(e){ id="anon"; }
          try{ mixpanel.identify(id); }catch(e){}
          try{ (mixpanel as any).__ttuns_ready=true; }catch(e){}
        })();
      `}</Script>
      <MixpanelProvider />
      {children}
    </>
  );
}
