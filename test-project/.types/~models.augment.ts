// Auto-generated. Do not edit.
import { Country } from '../src/models/country';
import { Post } from '../src/models/post';
import { User } from '../src/models/user';
import { Bureau } from '../src/models/bureau';
import { Region } from '../src/models/region';
import { Comment } from '../src/models/comment';
import { Profile } from '../src/models/profile';
import { UserAccount } from '../src/models/user-account';

declare module '../src/models/bureau' {
  interface Bureau {
  ['~shape']: {
    id: number;
    name: string | undefined;
  };

  ['~rel']: {
    countries: Country[];
  };

  ['~relInfo']: {
    countries: { target: Country; kind: 'one-to-many' };
  };
  }
}

declare module '../src/models/comment' {
  interface Comment {
  ['~shape']: {
    id: number;
    text: string | undefined;
    flagged: boolean | undefined;
    post: number | undefined;
    user: number | undefined;
  };

  ['~rel']: {
    post?: Post;
    user?: User;
  };

  ['~relInfo']: {
    post: { target: Post; kind: 'many-to-one' };
    user: { target: User; kind: 'many-to-one' };
  };
  }
}

declare module '../src/models/country' {
  interface Country {
  ['~shape']: {
    id: number;
    name: string | undefined;
    gov: number | undefined;
  };

  ['~rel']: {
    gov?: Bureau;
    regions: Region[];
  };

  ['~relInfo']: {
    gov: { target: Bureau; kind: 'many-to-one' };
    regions: { target: Region; kind: 'one-to-many' };
  };
  }
}

declare module '../src/models/user' {
  interface User {
  ['~shape']: {
    id: number;
    name: string | undefined;
    email: string | undefined;
    age: number | undefined;
    active: boolean | undefined;
    registeredAt: Date | undefined;
  };

  ['~rel']: {
    comments: Comment[];
    posts: Post[];
    accounts: UserAccount[];
    profile: Profile;
  };

  ['~relInfo']: {
    comments: { target: Comment; kind: 'one-to-many' };
    posts: { target: Post; kind: 'one-to-many' };
    accounts: { target: UserAccount; kind: 'one-to-many' };
    profile: { target: Profile; kind: 'one-to-one' };
  };
  }
}

declare module '../src/models/post' {
  interface Post {
  ['~shape']: {
    id: number;
    title: string | undefined;
    content: string | undefined;
    published: boolean;
    views: number;
    author: number | undefined;
  };

  ['~rel']: {
    author?: User;
    comments: Comment[];
  };

  ['~relInfo']: {
    author: { target: User; kind: 'many-to-one' };
    comments: { target: Comment; kind: 'one-to-many' };
  };
  }
}

declare module '../src/models/region' {
  interface Region {
  ['~shape']: {
    id: number;
    name: string | undefined;
    country: number | undefined;
  };

  ['~rel']: {
    country?: Country;
  };

  ['~relInfo']: {
    country: { target: Country; kind: 'many-to-one' };
  };
  }
}

declare module '../src/models/user-account' {
  interface UserAccount {
  ['~shape']: {
    id: string;
    displayLabel: string | undefined;
    createdBy: number | undefined;
  };

  ['~rel']: {
    createdBy?: User;
  };

  ['~relInfo']: {
    createdBy: { target: User; kind: 'many-to-one' };
  };
  }
}

declare module '../src/models/profile' {
  interface Profile {
  ['~shape']: {
    id: number;
    displayName: string | undefined;
    user: number | undefined;
  };

  ['~rel']: {
    user?: User;
  };

  ['~relInfo']: {
    user: { target: User; kind: 'one-to-one' };
  };
  }
}


export {};
