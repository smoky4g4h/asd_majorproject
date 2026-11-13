'use client';
import {useState} from 'react';
import type {User} from '../lib/domain';
export default function AccountAvatar({user}:{user:Pick<User,'name'|'avatarUrl'>}){
 const [failed,setFailed]=useState(false);
 const safe=user.avatarUrl?.startsWith('https://');
 return <span className="account-avatar">{safe&&!failed?<img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span aria-hidden="true">{user.name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase()}</span>}</span>;
}
