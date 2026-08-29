// Auto-generated. Do not edit.
import { Post } from '../src/models/post';
import { User } from '../src/models/user';
import { Comment } from '../src/models/comment';

declare module '../src/models/comment' {
  interface Comment {
  ['~shape']: {
    id: number;
    body: string | undefined;
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
    author: number | undefined;
    asas: number;
  };

  ['~rel']: {
    author?: User;
    comments: Comment[];
  };
  }
}

declare module '../src/models/post' {
  interface Post_posts {
  ['~shape']: {
    id: number;
    title: string | undefined;
    content: string | undefined;
    author: number | undefined;
    asas: number;
    title2: string | undefined;
  };

  ['~rel']: {
    author?: User;
    comments: Comment[];
  };
  }
}


export {};
