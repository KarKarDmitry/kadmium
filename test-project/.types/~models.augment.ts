// Auto-generated. Do not edit.
import { Post } from '../src/models/post';
import { User } from '../src/models/user';
import { Comment } from '../src/models/comment';

declare module '../src/models/comment' {
  interface Comment {
  ['~shape']: {
    id: number;
    text: string | undefined;
    post: number | undefined;
    user: number | undefined;
  };

  ['~rel']: {
    post?: Post;
    user?: User;
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
  }
}


export {};
